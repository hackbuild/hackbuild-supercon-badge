"""The LED bar as a game display: a countdown for the current phase, a pulse when live ink lands,
and a sweep while the panel redraws, so people across a room can see the badge is alive."""
import asyncio as aio
import time

from lib import hb_state
from lib.led_bar import NUM_LEDS, leds

_until = 0
_length = 1
_color = (0, 0, 6)
_pulse_until = 0
_task = None


def countdown(ms, color=(0, 0, 6)):
    """Fills the bar and drains it over ms. Zero clears it."""
    global _until, _length, _color
    _length = max(1, int(ms))
    _until = time.ticks_add(time.ticks_ms(), _length) if ms else 0
    _color = tuple(max(0, min(32, int(c))) for c in color)
    _start()


def pulse():
    global _pulse_until
    _pulse_until = time.ticks_add(time.ticks_ms(), 150)
    _start()


def off():
    global _until, _pulse_until
    _until = _pulse_until = 0
    leds.fill((0, 0, 0))
    leds.write()


def _start():
    global _task
    if _task is None:
        _task = aio.create_task(_loop())


async def _loop():
    global _task
    sweep = 0
    try:
        while hb_state.status["app"] == "play":
            now = time.ticks_ms()
            left = time.ticks_diff(_until, now) if _until else 0
            lit = (left * NUM_LEDS + _length - 1) // _length if left > 0 else 0
            busy = not hb_state.panel_idle()
            flash = time.ticks_diff(_pulse_until, now) > 0
            for i in range(NUM_LEDS):
                if flash:
                    c = (12, 12, 12)
                elif i < lit:
                    c = _color
                elif busy and i == sweep:
                    c = (6, 0, 0)
                else:
                    c = (0, 0, 0)
                leds[i] = c
            leds.write()
            sweep = (sweep + 1) % NUM_LEDS
            if not lit and not busy and not flash:
                await aio.sleep_ms(250)
            else:
                await aio.sleep_ms(80)
    finally:
        leds.fill((0, 0, 0))
        leds.write()
        _task = None
