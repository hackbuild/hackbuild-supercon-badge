"""Capsule: a slide show of the machine and how to get a coin.

User A shows the next slide and User B the previous one. A full e-paper refresh takes a while,
so a slide changes only after the panel has finished the last one and the hold time has passed.
"""
import os
import time

from apps.base_app import BaseApp
from lib import hb_state
from lib.button import UserA, UserB
from lib.led_bar import NUM_LEDS, leds

SLIDE_DIR = "/data/hb"
LED_RED = (3, 0, 0)


class CapsuleApp(BaseApp):
    _instance = None

    def __init__(self, name=None):
        super().__init__("Capsule")
        self.sleep_ms = 100
        self.slides = sorted(
            f for f in os.listdir(SLIDE_DIR) if f.startswith("s") and f.endswith(".png")
        )
        self.index = 0
        self.step = 0
        self.next_at = 0
        self.jump = None
        self.request = False
        CapsuleApp._instance = self

    def skip(self, step=1):
        """Asks for another slide on the next run; the remote link calls this too."""
        self.step = step

    def _show(self):
        self.index %= len(self.slides)
        hb_state.show_png(SLIDE_DIR + "/" + self.slides[self.index])
        hb_state.status["slide"] = self.index
        hb_state.status["slides"] = len(self.slides)
        hb_state.changed()
        for i in range(NUM_LEDS):
            leds[i] = LED_RED if i * len(self.slides) // NUM_LEDS == self.index else (0, 0, 0)
        leds.write()
        self.next_at = time.time() + hb_state.config["hold"]

    def run(self):
        if not self.slides:
            return
        if self.launched or self.request:
            self.request = False
            hb_state.remember("capsule")
            self.index = self.jump if self.jump is not None else 0
            self.jump = None
            self.step = 0
            self.next_at = 0
        if UserA.pressed():
            self.step = 1
        if UserB.pressed():
            self.step = -1
        if not hb_state.panel_idle():
            # Holds the clock while the panel refreshes, so every slide gets its full hold time.
            self.next_at = time.time() + hb_state.config["hold"]
            return
        if self.step:
            self.index += self.step
            self.step = 0
            self._show()
        elif self.next_at == 0:
            self._show()
        elif time.time() >= self.next_at:
            self.index += 1
            self._show()
