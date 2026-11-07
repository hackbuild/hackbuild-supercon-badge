"""Fast full screen e-paper refresh for the E2969JS0B1 panel, plus a faster bus for color updates.

The panel's own waveform takes about 33 s. The short table in data/rendered_luts.py takes about
3.5 s, in three passes. It drives black and white only, so red is sent as black here, and only the
panel's own waveform fully restores the film, so a color refresh should still run now and then.
"""
import asyncio as aio
import gc
import time

import micropython
from machine import SPI, Pin
from micropython import const

from lib import epd as _epd
from lib.epd import display

_DC, _RST = _epd.EPD_DC_PIN, _epd.EPD_RST_PIN
_CS_L, _CS_R = _epd.EPD_CS1_PIN, _epd.EPD_CS2_PIN
_BUSY_L, _BUSY_R = _epd.EPD_BUSY1_PIN, _epd.EPD_BUSY2_PIN
_SCK, _SDA, _MISO = _epd.EPD_SCL_PIN, _epd.EPD_SDA_PIN, _epd.EPD_SPI_MISO_PIN

_HALF_PLANE = const(40320)  # 60 bytes x 672 lines, for each of the two controllers
_OTP_LEN = const(88)
_PASSES = const(3)
_BUS_HZ = const(20_000_000)
_BUSY_TIMEOUT_MS = const(20_000)

_otp = None
_lut = None
_bufs = None
_rev = None
_failed = False


def _select(left, right):
    # The unwanted side goes high first, so the two controllers never both listen by accident.
    if not left:
        _CS_L.value(1)
    if not right:
        _CS_R.value(1)
    if left:
        _CS_L.value(0)
    if right:
        _CS_R.value(0)


def _deselect():
    _CS_L.value(1)
    _CS_R.value(1)


def _reg(index, data=b"", left=True, right=True):
    """Register write over the driver's own bit-banged bus."""
    _DC.value(0)
    _select(left, right)
    display.spi.write(bytes((index,)))
    _deselect()
    if data:
        _DC.value(1)
        _select(left, right)
        display.spi.write(data)
        _deselect()


def _idle():
    return _BUSY_L.value() == 1 and _BUSY_R.value() == 1


async def _wait(idle, timeout_ms):
    t0 = time.ticks_ms()
    while _idle() != idle:
        if time.ticks_diff(time.ticks_ms(), t0) >= timeout_ms:
            return False
        await aio.sleep_ms(2)
    return True


def _bus():
    return SPI(1, baudrate=_BUS_HZ, polarity=0, phase=0, sck=_SCK, mosi=_SDA, miso=_MISO)


def _bus_done(bus):
    bus.deinit()
    # The registers go back over the bit-banged bus, which needs these as plain outputs.
    _SCK.init(Pin.OUT, value=0)
    _SDA.init(Pin.OUT, value=0)


async def _reset(wait_ms, hi_ms, lo_ms, set_ms):
    await aio.sleep_ms(wait_ms)
    _RST.value(1)
    await aio.sleep_ms(hi_ms)
    _RST.value(0)
    await aio.sleep_ms(lo_ms)
    _RST.value(1)
    await aio.sleep_ms(set_ms)


# The panel's calibration block only reads back when clocked at a few tens of kHz.
def _slow_out(v):
    for _ in range(8):
        _SDA.value(v & 0x80)
        time.sleep_us(10)
        _SCK.value(1)
        time.sleep_us(10)
        _SCK.value(0)
        time.sleep_us(10)
        v <<= 1


def _slow_in():
    v = 0
    for _ in range(8):
        _SCK.value(1)
        time.sleep_us(10)
        v = (v << 1) | _SDA.value()
        _SCK.value(0)
        time.sleep_us(10)
    return v


async def _park():
    """Leaves the panel the way the stock driver expects to find it."""
    _DC.value(0)
    _select(True, True)
    await aio.sleep_ms(20)
    _RST.value(0)
    await aio.sleep_ms(50)
    _deselect()


async def _load_calibration():
    """Reads the panel's own register values once per boot. False means this is not the expected panel."""
    global _otp, _lut, _bufs, _failed
    await _reset(800, 50, 100, 400)
    _reg(0x70, b"\x71\x36")
    _DC.value(0)
    _select(True, False)
    _slow_out(0xB9)
    time.sleep_ms(1)
    _DC.value(1)
    _SDA.init(Pin.IN, Pin.PULL_DOWN)
    try:
        _slow_in()
        raw = bytearray(_OTP_LEN)
        for i in range(_OTP_LEN):
            raw[i] = _slow_in()
    finally:
        _deselect()
        _SDA.init(Pin.OUT, value=0)
    await _reset(50, 0, 100, 400)
    await _park()
    if raw[0x16] != 0x3B or raw[0x0D] != 0x3B or not raw[0x28] & 0x80:
        print("hb_fast: unexpected panel calibration", bytes(raw[:32]))
        _failed = True
        return False
    # This panel stores the block shifted; the ramp stages are checked because a bad one hangs BUSY.
    for i in range(0x1E, 0x12, -1):
        raw[i] = raw[i - 1]
    for i in range(32):
        raw[0x20 + i] = raw[0x28 + i]
    for stage in range(4):
        b = raw[0x20 + 8 * stage]
        if b == 0xFF or not 0 < (b & 0x7F) <= 40:
            print("hb_fast: implausible booster ramp", stage, b)
            _failed = True
            return False
    from data import rendered_luts
    _lut = bytes(rendered_luts.lutb_base)
    del rendered_luts
    if len(_lut) != 400:
        _failed = True
        return False
    _otp = bytes(raw)
    _bufs = (bytearray(_HALF_PLANE), bytearray(_HALF_PLANE))
    gc.collect()
    return True


@micropython.viper
def _split(left, right, black, red):
    """Splits a frame between the two controllers, with red drawn as black."""
    dl = ptr8(left)
    dr = ptr8(right)
    sb = ptr8(black)
    sr = ptr8(red)
    y = 0
    while y < 672:
        s = y * 120
        d = y * 60
        i = 0
        while i < 60:
            dl[d + i] = sb[s + i] | sr[s + i]
            dr[d + i] = sb[s + 60 + i] | sr[s + 60 + i]
            i += 1
        y += 1


def _write_frame(zero):
    o = _otp
    _reg(0x01, o[0x10:0x11])
    _reg(0x13, o[0x16:0x1C])
    _reg(0x90, o[0x0C:0x10])
    left, right = _bufs
    bus = _bus()
    try:
        for index, a, b in ((0x10, left, right), (0x11, zero, zero)):
            _bus_done(bus)
            _reg(0x12, o[0x13:0x16])
            _DC.value(0)
            _select(True, True)
            display.spi.write(bytes((index,)))
            _deselect()
            _DC.value(1)
            bus = _bus()
            _select(True, False)
            bus.write(a)
            _deselect()
            _select(False, True)
            bus.write(b)
            _deselect()
    finally:
        _bus_done(bus)


def _ramp():
    """The booster ramp, with this panel's own values."""
    o = _otp
    for stage in range(4):
        off = 0x20 + 8 * stage
        rep = o[off] & 0x7F
        if o[off] & 0x80:
            a, b = o[off + 1], o[off + 2]
            for _ in range(rep):
                _reg(0x09, o[off + 5:off + 6])
                a = (a + o[off + 3]) & 0xFF
                b = (b + o[off + 4]) & 0xFF
                _reg(0x51, bytes((a, b)))
                _reg(0x09, o[off + 6:off + 7])
                _delay(o[off + 7])
        else:
            for _ in range(rep):
                _reg(0x09, o[off + 1:off + 2])
                _delay(o[off + 3])
                _reg(0x09, o[off + 2:off + 3])
                _delay(o[off + 4])


def _delay(d):
    if d & 0x80:
        time.sleep_ms((d & 0x7F) or 1)
    else:
        time.sleep_us(10 * (d & 0x7F))


async def _start_booster():
    o = _otp
    await aio.sleep_ms(10)
    for cmd, arg, ms in (
        (0x05, b"\x7d", 50), (0x05, b"\x00", 1), (0xD8, o[0x1D:0x1E], 0), (0xD6, o[0x1E:0x1F], 0),
        (0xA7, b"\x10", 2), (0xA7, b"\x00", 10), (0x44, b"\x00", 0), (0x45, b"\x80", 0),
        (0xA7, b"\x10", 2), (0xA7, b"\x00", 10), (0x44, b"\x06", 0), (0x45, b"\x84", 0),
        (0xA7, b"\x10", 2), (0xA7, b"\x00", 10), (0x60, o[0x0B:0x0C], 0), (0x61, o[0x1C:0x1D], 0),
        (0x02, o[0x11:0x12], 0),
    ):
        _reg(cmd, arg)
        if ms:
            await aio.sleep_ms(ms)
    _reg(0xB0, _lut)
    _ramp()
    await aio.sleep_ms(5)
    return _idle() or await _wait(True, 10_000)


async def _pass():
    _reg(0x15, b"\x3c")
    return await _wait(False, 2000) and await _wait(True, _BUSY_TIMEOUT_MS)


async def _stop_booster():
    _reg(0x09, b"\x7f")
    await aio.sleep_ms(20)
    _reg(0x05, b"\x7d")
    _reg(0x09, b"\x00")
    await aio.sleep_ms(200)
    await _wait(True, 2000)


async def show():
    """Shows the framebuffers. Returns milliseconds, or None if the caller should use a color update."""
    if _failed or (_otp is None and not await _load_calibration()):
        return None
    t0 = time.ticks_ms()
    _split(_bufs[0], _bufs[1], display._framebuffer_black, display._framebuffer_red)
    await _reset(5, 2, 4, 20)
    ok = False
    try:
        zero = bytes(_HALF_PLANE)
        _write_frame(zero)
        del zero
        if await _start_booster():
            ok = True
            for _ in range(_PASSES):
                ok = ok and await _pass()
        await _stop_booster()
    finally:
        await _park()
    if not ok:
        print("hb_fast: refresh failed, falling back to a color update")
        return None
    return time.ticks_diff(time.ticks_ms(), t0)


# ---- faster data for the stock color update ----

def _make_rev():
    global _rev
    t = bytearray(256)
    for i in range(256):
        b = (i & 0xF0) >> 4 | (i & 0x0F) << 4
        b = (b & 0xCC) >> 2 | (b & 0x33) << 2
        t[i] = (b & 0xAA) >> 1 | (b & 0x55) << 1
    _rev = bytes(t)


@micropython.viper
def _reverse(buf, table, n: int):
    d = ptr8(buf)
    t = ptr8(table)
    i = 0
    while i < n:
        d[i] = t[d[i]]
        i += 1


def _send_images(self, black_left, red_left, black_right, red_right):
    """Same register sequence as the stock driver, over hardware SPI with no per byte Python loop."""
    if self._reverse_fb_bits:
        if _rev is None:
            _make_rev()
        for b in (black_left, red_left, black_right, red_right):
            _reverse(b, _rev, _HALF_PLANE)
    self._send_index_data(0x13, [0x00, 0x3B, 0x00, 0x00, 0x9F, 0x02])
    self._send_index_data(0x90, [0x00, 0x3B, 0x00, 0xA9])
    ram = [0x3B, 0x00, 0x14]
    for send, cs, planes in (
        (self._send_index_data_left, _CS_L, ((0x10, black_left), (0x11, red_left))),
        (self._send_index_data_right, _CS_R, ((0x10, black_right), (0x11, red_right))),
    ):
        for index, data in planes:
            send(0x12, ram)
            _DC.value(0)
            cs.value(0)
            self.spi.write(bytes((index,)))
            cs.value(1)
            _DC.value(1)
            bus = _bus()
            try:
                cs.value(0)
                bus.write(data)
                cs.value(1)
            finally:
                _bus_done(bus)


type(display)._send_images = _send_images
