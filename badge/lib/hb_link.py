"""Connects the badge to WiFi and the CLASP relay, and takes signed commands from the web controller.

The relay is public, so every command carries an HMAC of its JSON made with the badge key and a
one time nonce the badge publishes in its state. Images arrive as chunks after a signed start
message holding their SHA-256, so an unsigned chunk can only make a transfer fail.
"""
import asyncio as aio
import binascii
import gc
import hashlib
import json
import os
import sys
import time

import network

from lib import hb_ink, hb_lights, hb_state
from lib.board import reg_in_v_sns
from lib.hb_clasp import Clasp
from lib.led_bar import leds

CHUNK_LIMIT = 400000
STATE_EVERY_S = 30
PING_EVERY_S = 15
# The relay counts only traffic it forwards to a client as activity, not its pongs, and after 300 s
# drops the session's subscriptions while leaving the socket open. Status would keep flowing out and
# commands would silently stop, so an idle session is replaced before that can happen.
RENEW_AFTER_S = 240
# A half open connection on flaky wifi answers nothing, so connecting and subscribing are bounded.
CONNECT_TIMEOUT_S = 25


class _Hmac:
    """HMAC-SHA256 with the pads worked out once, since live ink checks several messages a second."""

    def __init__(self, key):
        if len(key) > 64:
            key = hashlib.sha256(key).digest()
        block = key + b"\0" * (64 - len(key))
        self.ipad = bytes(b ^ 0x36 for b in block)
        self.opad = bytes(b ^ 0x5C for b in block)

    def __call__(self, msg):
        inner = hashlib.sha256(self.ipad)
        inner.update(msg)
        outer = hashlib.sha256(self.opad)
        outer.update(inner.digest())
        return outer.digest()


def _hex(b):
    return binascii.hexlify(b).decode()


class Link:
    def __init__(self, switcher):
        self.switcher = switcher
        self.key = hb_state.config["key"].encode()
        self.sign = _Hmac(self.key)
        self.ink_sid = ""
        self.ink_seq = -1
        self.room = _hex(hashlib.sha256(self.key).digest())[:16]
        self.base = "/hb/badge/" + self.room
        self.nonce = _hex(os.urandom(8))
        self.client = None
        self.outbox = []
        self.transfer = None
        # The last chunk ack sent. A repeated chunk means the host missed it, so it is sent again.
        self.acked_id = ""
        self.acked_seq = -1
        self.started = time.time()
        self.last_rx = self.started
        self.sta = network.WLAN(network.STA_IF)

    def goto(self, app, keep_slide=False):
        """Switches app the way the menu does, including when the menu is open."""
        if keep_slide and app == "capsule":
            from apps.b_capsule import CapsuleApp
            if CapsuleApp._instance:
                CapsuleApp._instance.jump = CapsuleApp._instance.index
        names = {"logo": "hack.build", "capsule": "Capsule", "image": "Sent", "play": "Play"}
        sw = self.switcher
        for i, a in enumerate(sw.apps):
            if a.name == names.get(app):
                if sw.selecting_mode or sw.active_idx != i:
                    leds.clear_sequence()
                    leds.fill((0, 0, 0))
                # The switcher clears launched just after an await, which would lose a remote
                # switch, so these apps also take a request flag the switcher never touches.
                a.request = True
                sw.selection_idx = i
                sw.active_idx = i
                sw.selecting_mode = False
                return True
        return False

    def on_message(self, address, value):
        self.last_rx = time.time()
        if not isinstance(value, str):
            return
        try:
            self.route(address, value)
        except Exception as ex:
            # An exception here would end the reader task and drop the relay session, so a bad
            # command, chunk or stroke costs only itself.
            print("hb_link: message failed", address[len(self.base):])
            sys.print_exception(ex)

    def route(self, address, value):
        if address == self.base + "/keep":
            # A page that just opened asks for fresh status, so it can tell the badge is really on.
            if value == "hello":
                hb_state.changed()
            return
        if address == self.base + "/cmd":
            self.on_command(value)
        elif address == self.base + "/chunk":
            self.on_chunk(value)
        elif address == self.base + "/ink":
            self.on_ink(value)

    def on_ink(self, envelope):
        """A live ink batch: "session:seq:sig:strokes". Signed like commands, but numbered instead of
        nonced, since a stream cannot wait a round trip per message."""
        try:
            sid, seq, sig, data = envelope.split(":", 3)
            seq = int(seq)
        except ValueError:
            return
        if _hex(self.sign(("%s:%d:%s" % (sid, seq, data)).encode()))[:32] != sig:
            return
        if sid == self.ink_sid and seq <= self.ink_seq:
            return
        self.ink_sid, self.ink_seq = sid, seq
        hb_ink.apply(data)
        hb_lights.pulse()

    def press(self, button):
        """A user button in the Play app, for the host to turn into a game control."""
        self.send("/press", button)
        hb_lights.pulse()

    def on_command(self, envelope):
        sig, _, body = envelope.partition(":")
        if _hex(self.sign(body.encode())) != sig:
            print("hb_link: bad signature")
            return
        msg = json.loads(body)
        if msg.get("n") != self.nonce:
            print("hb_link: stale nonce")
            return
        self.nonce = _hex(os.urandom(8))
        hb_state.changed()
        self.apply(msg.get("c"), msg.get("v"))

    def apply(self, cmd, val):
        print("hb_link: command", cmd)
        if cmd == "app":
            self.goto(val)
        elif cmd == "next":
            from apps.b_capsule import CapsuleApp
            if hb_state.status["app"] != "capsule":
                self.goto("capsule")
            elif CapsuleApp._instance:
                CapsuleApp._instance.skip(int(val or 1))
        elif cmd == "slide":
            from apps.b_capsule import CapsuleApp
            if CapsuleApp._instance:
                CapsuleApp._instance.jump = int(val)
                self.goto("capsule")
        elif cmd == "pause":
            from apps.b_capsule import CapsuleApp
            if CapsuleApp._instance:
                CapsuleApp._instance.paused = bool(val)
                hb_state.status["paused"] = bool(val)
        elif cmd == "hold":
            hb_state.config["hold"] = max(2, min(3600, int(val)))
            hb_state.save()
        elif cmd == "quality":
            hb_state.config["quality"] = "color" if val == "color" else "fast"
            hb_state.save()
        elif cmd == "redraw":
            # Runs the current screen again through the panel's own waveform, in full color.
            hb_state.want_color_once()
            self.goto(hb_state.status["app"], keep_slide=True)
        elif cmd == "led":
            leds.clear_sequence()
            leds.fill(tuple(max(0, min(32, int(c))) for c in val))
        elif cmd == "play":
            # mode is join, frame, ink or reel. ink with keep draws over the screen already there.
            from apps.d_play import PlayApp
            if PlayApp._instance:
                if val.get("mode") == "ink" and val.get("keep") is False:
                    hb_ink.clear()
                PlayApp._instance.set_mode(val.get("mode", "join"))
                self.goto("play")
        elif cmd == "lights":
            # ms drains the LED bar over a game phase; 0 clears it.
            hb_lights.countdown(int(val.get("ms", 0)), val.get("c") or (0, 0, 6))
        elif cmd in ("img", "reel"):
            size = int(val["size"])
            if not 0 < size <= CHUNK_LIMIT:
                self.fail("image size out of range")
                return
            # Dropped first, so a restarted send never holds two buffers on the heap at once.
            self.transfer = None
            gc.collect()
            # A screen for the Play app or a reel goes there; anything else is a message for Sent.
            to = "reel" if cmd == "reel" else "play" if val.get("to") == "play" else "sent"
            self.transfer = {"id": val["id"], "size": size, "sha": val["sha"], "next": 0,
                             "color": bool(val.get("color")), "to": to, "then": val.get("then", ""),
                             "loops": max(0, min(100, int(val.get("loops", 2)))),
                             "got": 0, "buf": bytearray(size)}
            self.acked_id, self.acked_seq = val["id"], -1
            self.send("/ack", val["id"] + ":-1")

    def fail(self, why):
        print("hb_link:", why)
        hb_state.status["err"] = why
        hb_state.changed()

    def on_chunk(self, value):
        tid, seq, data = value.split(":", 2)
        t = self.transfer
        if not t or tid != t["id"] or int(seq) != t["next"]:
            # A repeat or a gap, or a chunk after the end: the host is resending because an ack was
            # lost. Repeating the last ack lets it move on instead of stalling out.
            if tid == self.acked_id:
                self.send("/ack", "%s:%d" % (tid, self.acked_seq))
            return
        raw = binascii.a2b_base64(data)
        if t["got"] + len(raw) > t["size"]:
            self.transfer = None
            self.fail("image overran its size")
            return
        t["buf"][t["got"]:t["got"] + len(raw)] = raw
        t["got"] += len(raw)
        t["next"] += 1
        self.acked_seq = t["next"] - 1
        self.send("/ack", "%s:%d" % (tid, self.acked_seq))
        if t["got"] == t["size"]:
            self.finish()

    def finish(self):
        t = self.transfer
        self.transfer = None
        if _hex(hashlib.sha256(t["buf"]).digest()) != t["sha"]:
            self.fail("image failed its checksum")
            return
        color, to, then, loops = t["color"], t["to"], t["then"], t["loops"]
        from apps.d_play import FRAME_PATH, REEL_PATH, PlayApp
        path = {"reel": REEL_PATH, "play": FRAME_PATH}.get(to, hb_state.SENT_PATH)
        # Written beside the old file and swapped in, so a reel still playing never reads half a file.
        tmp = path + ".new"
        try:
            with open(tmp, "wb") as f:
                f.write(t["buf"])
            try:
                os.rename(tmp, path)
            except OSError:
                # littlefs replaces the target in one step. A filesystem that refuses needs it removed.
                os.remove(path)
                os.rename(tmp, path)
        except OSError as ex:
            print("hb_link: save failed", ex)
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.fail("image did not save")
            return
        del t
        gc.collect()
        hb_state.status["err"] = ""
        if color:
            hb_state.want_color_once()
        if to == "sent" or not PlayApp._instance:
            self.goto("image")
            return
        # A frame followed by live ink becomes the page the crowd draws on.
        PlayApp._instance.set_mode("reel" if to == "reel" else "inkframe" if then == "ink" else "frame", loops)
        self.goto("play")

    def send(self, suffix, text):
        self.outbox.append((suffix, text))

    def state_json(self):
        s = hb_state.status
        s["ip"] = self.sta.ifconfig()[0] if self.sta.isconnected() else ""
        try:
            s["rssi"] = self.sta.status("rssi")
        except (OSError, ValueError):
            s["rssi"] = 0
        return json.dumps({
            "n": self.nonce, "app": s["app"], "slide": s["slide"], "slides": s["slides"],
            "hold": hb_state.config["hold"], "busy": not hb_state.panel_idle(),
            "quality": hb_state.config["quality"], "color": s["color"], "paused": s["paused"],
            "fast_ms": s["fast_ms"], "color_ms": s["color_ms"], "load_ms": s["load_ms"], "wifi": s["wifi"],
            "ip": s["ip"], "rssi": s["rssi"], "err": s["err"],
            "play": s.get("play", ""), "loop": s.get("loop", False), "frame": s.get("frame", 0),
            "vin": round(reg_in_v_sns.read_uv() * 2 / 1000000, 2),
            "up": time.time() - self.started, "mem": gc.mem_free(),
        })

    def known_networks(self):
        """Known networks in range strongest first, then the unseen ones: a phone hotspot often answers
        a join by name while it stays out of scans."""
        known = hb_state.config["networks"]
        try:
            seen = {}
            for ap in self.sta.scan():
                name = ap[0].decode()
                seen[name] = max(seen.get(name, -999), ap[3])
            print("hb_link: networks in range", list(seen))
            hits = [n for n in known if n["ssid"] in seen]
            hits.sort(key=lambda n: -seen[n["ssid"]])
            return hits + [n for n in known if n["ssid"] not in seen]
        except (OSError, UnicodeError) as ex:
            print("hb_link: scan failed", ex)
            return known

    async def wifi(self):
        if self.sta.isconnected():
            return True
        hb_state.status["wifi"] = ""
        # After a dropped network the driver keeps reconnecting on its own, and then scans come
        # back empty and connect() raises "Wifi Internal Error". Power cycling the radio clears it.
        try:
            self.sta.disconnect()
        except OSError:
            pass
        self.sta.active(False)
        await aio.sleep_ms(300)
        self.sta.active(True)
        try:
            self.sta.config(pm=self.sta.PM_NONE)
        except (OSError, ValueError, AttributeError):
            pass
        for net in self.known_networks():
            print("hb_link: joining", net["ssid"])
            try:
                self.sta.connect(net["ssid"], net["password"])
            except OSError as ex:
                print("hb_link: connect refused", net["ssid"], ex)
                continue
            for _ in range(30):
                if self.sta.isconnected():
                    hb_state.status["wifi"] = net["ssid"]
                    print("hb_link: wifi", net["ssid"], self.sta.ifconfig()[0])
                    return True
                await aio.sleep_ms(500)
            print("hb_link: could not join", net["ssid"], self.sta.status())
            self.sta.disconnect()
        return False

    async def writer(self):
        """Sends queued messages, state on change and keepalives. Raises when the link drops."""
        last_state = last_ping = 0
        was_busy = None
        while True:
            now = time.time()
            busy = not hb_state.panel_idle()
            if was_busy and not busy and hb_state.status["color"] and hb_state.status.get("color_started"):
                hb_state.status["color_ms"] = time.ticks_diff(time.ticks_ms(), hb_state.status["color_started"])
                hb_state.status["color_started"] = 0
            if hb_state.take_dirty() or busy != was_busy or now - last_state >= STATE_EVERY_S:
                was_busy = busy
                last_state = now
                await self.client.set(self.base + "/state", self.state_json())
            if now - last_ping >= PING_EVERY_S:
                last_ping = now
                await self.client.ping()
            while self.outbox:
                suffix, text = self.outbox.pop(0)
                await self.client.emit(self.base + suffix, text)
            await aio.sleep_ms(100)

    async def open_relay(self):
        await self.client.connect()
        print("hb_link: on relay as", self.base)
        await self.client.subscribe(self.base + "/cmd", 1)
        await self.client.subscribe(self.base + "/chunk", 2)
        await self.client.subscribe(self.base + "/keep", 3)
        await self.client.subscribe(self.base + "/ink", 4)

    async def session(self):
        self.client = Clasp(hb_state.config["relay"], "hack.build badge")
        self.client.on_message = self.on_message
        reader = writer = None
        try:
            await aio.wait_for(self.open_relay(), CONNECT_TIMEOUT_S)
            # Acks and presses queued while offline are stale, and a press would run a game control late.
            self.outbox = []
            self.last_rx = time.time()
            hb_state.changed()
            reader = aio.create_task(self.client.run())
            writer = aio.create_task(self.writer())
            while not reader.done() and not writer.done():
                # Checked here, not in the writer, which can sit in a send that never drains.
                if time.time() - self.last_rx >= RENEW_AFTER_S:
                    raise OSError("renewing relay session")
                await aio.sleep_ms(200)
        finally:
            for task in (reader, writer):
                if task:
                    task.cancel()
            self.client.close()

    async def run(self):
        if not hb_state.config["networks"] or not self.key:
            print("hb_link: no wifi or key in config, staying offline")
            return
        wait = 2
        while True:
            try:
                if await self.wifi():
                    wait = 2
                    await self.session()
            except Exception as ex:
                print("hb_link: session ended")
                sys.print_exception(ex)
            self.transfer = None
            gc.collect()
            await aio.sleep(wait)
            wait = min(wait * 2, 60)


def start(switcher):
    """Opens the main app and starts the remote link. Called once from main.py."""
    link = Link(switcher)
    from apps.d_play import PlayApp
    if PlayApp._instance:
        PlayApp._instance.on_press = link.press
    # The film state is unknown after a reset, so the first screen gets the full waveform.
    hb_state.want_color_once()
    link.goto("logo")
    aio.create_task(link.run())
    return link
