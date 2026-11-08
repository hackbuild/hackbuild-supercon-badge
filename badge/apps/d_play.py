"""Play: the crowd games screen.

With no game running it shows how to join. A host page then sends it game screens, live ink or a
flip book reel. The remote link sets the mode; the menu buttons leave the app as usual.
"""
import asyncio as aio
import struct

from apps.base_app import BaseApp
from lib import hb_fast, hb_ink, hb_state

JOIN_PATH = "/data/hb/join.z"
FRAME_PATH = "/data/hb/play.z"
REEL_PATH = "/data/hb/reel.bin"
REEL_LOOPS = 2


class PlayApp(BaseApp):
    _instance = None

    def __init__(self, name=None):
        super().__init__("Play")
        self.sleep_ms = 100
        self.request = False
        self.mode = "join"
        self.pending = False
        self.reel_task = None
        PlayApp._instance = self

    def set_mode(self, mode):
        """Called by the remote link. Takes effect on the next run, after the panel is idle."""
        self.mode = mode
        self.pending = True

    def run(self):
        if self.launched or self.request:
            self.request = False
            self.pending = True
            hb_state.remember("play")
        if self.mode not in ("ink", "inkframe") and hb_ink.active:
            hb_ink.stop()
        if not self.pending or not hb_state.panel_idle():
            return
        self.pending = False
        if self.mode == "ink":
            if not hb_ink.active:
                hb_ink.start()
        elif self.mode == "inkframe":
            self.mode = "ink"
            hb_state.load(FRAME_PATH)
            hb_ink.start(clear_page=False)
        elif self.mode == "reel":
            if self.reel_task is None:
                self.reel_task = aio.create_task(self._play_reel())
        elif self.mode == "frame":
            if not hb_state.show(FRAME_PATH):
                hb_state.show(JOIN_PATH)
        else:
            hb_state.show(JOIN_PATH)

    async def _play_reel(self):
        """Plays every frame with one quick pass each, then cleans the last one with three."""
        hb_state.holding = True
        hb_state.changed()
        try:
            with open(REEL_PATH, "rb") as f:
                count = struct.unpack("<H", f.read(2))[0]
                offsets = struct.unpack("<%dI" % count, f.read(4 * count))
            for loop in range(REEL_LOOPS):
                for i, at in enumerate(offsets):
                    if self.mode != "reel":
                        return
                    if not hb_state.load(REEL_PATH, at):
                        return
                    last = loop == REEL_LOOPS - 1 and i == count - 1
                    # Quick frames keep the booster running; the last frame gets a clean refresh.
                    await hb_state.refresh(3 if last else 1, stay_on=not last)
        except (OSError, ValueError) as ex:
            print("play: reel failed", ex)
        finally:
            await hb_fast.cool()
            hb_state.holding = False
            hb_state.changed()
            self.reel_task = None
