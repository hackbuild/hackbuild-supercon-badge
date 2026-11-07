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

from lib import hb_state
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


def _hmac(key, msg):
    block = key + b"\0" * (64 - len(key))
    inner = hashlib.sha256(bytes(b ^ 0x36 for b in block))
    inner.update(msg)
    outer = hashlib.sha256(bytes(b ^ 0x5C for b in block))
    outer.update(inner.digest())
    return outer.digest()


def _hex(b):
    return binascii.hexlify(b).decode()


class Link:
    def __init__(self, switcher):
        self.switcher = switcher
        self.key = hb_state.config["key"].encode()
        self.room = _hex(hashlib.sha256(self.key).digest())[:16]
        self.base = "/hb/badge/" + self.room
        self.nonce = _hex(os.urandom(8))
        self.client = None
        self.outbox = []
        self.transfer = None
        self.started = time.time()
        self.last_rx = self.started
        self.sta = network.WLAN(network.STA_IF)

    def goto(self, app, keep_slide=False):
        """Switches app the way the menu does, including when the menu is open."""
        if keep_slide and app == "capsule":
            from apps.b_capsule import CapsuleApp
            if CapsuleApp._instance:
                CapsuleApp._instance.jump = CapsuleApp._instance.index
        names = {"logo": "hack.build", "capsule": "Capsule", "image": "Sent"}
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
        if address == self.base + "/keep":
            # A page that just opened asks for fresh status, so it can tell the badge is really on.
            if value == "hello":
                hb_state.changed()
            return
        if address == self.base + "/cmd":
            self.on_command(value)
        elif address == self.base + "/chunk":
            self.on_chunk(value)

    def on_command(self, envelope):
        sig, _, body = envelope.partition(":")
        if _hex(_hmac(self.key, body.encode())) != sig:
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
        elif cmd == "img":
            size = int(val["size"])
            if size > CHUNK_LIMIT:
                self.fail("image too large")
                return
            gc.collect()
            self.transfer = {"id": val["id"], "size": size, "sha": val["sha"], "next": 0,
                             "color": bool(val.get("color")),
                             "got": 0, "buf": bytearray(size)}
            self.send("/ack", val["id"] + ":-1")

    def fail(self, why):
        print("hb_link:", why)
        hb_state.status["err"] = why
        hb_state.changed()

    def on_chunk(self, value):
        t = self.transfer
        if not t:
            return
        tid, seq, data = value.split(":", 2)
        if tid != t["id"] or int(seq) != t["next"]:
            return
        raw = binascii.a2b_base64(data)
        if t["got"] + len(raw) > t["size"]:
            self.transfer = None
            self.fail("image overran its size")
            return
        t["buf"][t["got"]:t["got"] + len(raw)] = raw
        t["got"] += len(raw)
        t["next"] += 1
        self.send("/ack", tid + ":" + seq)
        if t["got"] == t["size"]:
            self.finish()

    def finish(self):
        t = self.transfer
        self.transfer = None
        if _hex(hashlib.sha256(t["buf"]).digest()) != t["sha"]:
            self.fail("image failed its checksum")
            return
        color = t["color"]
        with open(hb_state.SENT_PATH, "wb") as f:
            f.write(t["buf"])
        del t
        gc.collect()
        hb_state.status["err"] = ""
        if color:
            hb_state.want_color_once()
        self.goto("image")

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
        self.sta.active(True)
        try:
            self.sta.config(pm=self.sta.PM_NONE)
        except (OSError, ValueError, AttributeError):
            pass
        for net in self.known_networks():
            print("hb_link: joining", net["ssid"])
            self.sta.connect(net["ssid"], net["password"])
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
            if now - self.last_rx >= RENEW_AFTER_S:
                raise OSError("renewing relay session")
            if now - last_ping >= PING_EVERY_S:
                last_ping = now
                await self.client.ping()
            while self.outbox:
                suffix, text = self.outbox.pop(0)
                await self.client.emit(self.base + suffix, text)
            await aio.sleep_ms(100)

    async def session(self):
        self.client = Clasp(hb_state.config["relay"], "hack.build badge")
        self.client.on_message = self.on_message
        await self.client.connect()
        print("hb_link: on relay as", self.base)
        await self.client.subscribe(self.base + "/cmd", 1)
        await self.client.subscribe(self.base + "/chunk", 2)
        await self.client.subscribe(self.base + "/keep", 3)
        self.last_rx = time.time()
        hb_state.changed()
        reader = aio.create_task(self.client.run())
        writer = aio.create_task(self.writer())
        try:
            while not reader.done() and not writer.done():
                await aio.sleep_ms(200)
        finally:
            reader.cancel()
            writer.cancel()
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
    # The film state is unknown after a reset, so the first screen gets the full waveform.
    hb_state.want_color_once()
    link.goto("logo")
    aio.create_task(link.run())
    return link
