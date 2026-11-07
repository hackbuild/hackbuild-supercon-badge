"""A minimal CLASP client for MicroPython asyncio: WebSocket over TLS, compact binary encoding.

Covers HELLO, SUBSCRIBE, SET and PUBLISH with string values, which is all the badge needs.
The wire format follows crates/clasp-core/src/codec.rs in lumencanvas/clasp.
"""
import asyncio as aio
import binascii
import os
import ssl
import struct

MAGIC = 0x53
ENC_BINARY = 1
QOS_FIRE, QOS_CONFIRM = 0, 1
M_HELLO, M_WELCOME, M_SUBSCRIBE, M_PUBLISH, M_SET, M_SNAPSHOT = 0x01, 0x02, 0x10, 0x20, 0x21, 0x23
M_PING, M_PONG, M_ACK, M_ERROR = 0x41, 0x42, 0x50, 0x51
V_NULL, V_BOOL, V_I64, V_F64, V_STRING, V_BYTES = 0x00, 0x01, 0x05, 0x07, 0x08, 0x09
SIG_EVENT = 1


def _s(text):
    b = text.encode()
    return struct.pack(">H", len(b)) + b


def _read_s(buf, i):
    n = struct.unpack_from(">H", buf, i)[0]
    i += 2
    return bytes(buf[i:i + n]).decode(), i + n


def _read_value(buf, i, vtype):
    """Returns (value, next index). Arrays and maps are not used here and end the parse."""
    if vtype == V_NULL:
        return None, i
    if vtype == V_BOOL:
        return buf[i] != 0, i + 1
    if vtype == V_I64:
        return struct.unpack_from(">q", buf, i)[0], i + 8
    if vtype == V_F64:
        return struct.unpack_from(">d", buf, i)[0], i + 8
    if vtype == V_STRING:
        return _read_s(buf, i)
    if vtype == V_BYTES:
        n = struct.unpack_from(">H", buf, i)[0]
        return bytes(buf[i + 2:i + 2 + n]), i + 2 + n
    raise ValueError("value type")


class Clasp:
    def __init__(self, host, name, port=443):
        self.host, self.port, self.name = host, port, name
        self.reader = self.writer = None
        self.on_message = None  # called as on_message(address, value)

    async def connect(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        # No CA bundle on the badge. Commands are authenticated separately with HMAC.
        ctx.verify_mode = ssl.CERT_NONE
        self.reader, self.writer = await aio.open_connection(self.host, self.port, ctx)
        key = binascii.b2a_base64(os.urandom(16)).strip().decode()
        self.writer.write(
            "GET / HTTP/1.1\r\nHost: {}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            "Sec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n"
            "Sec-WebSocket-Protocol: clasp\r\n\r\n".format(self.host, key).encode()
        )
        await self.writer.drain()
        status = await self.reader.readline()
        if b"101" not in status:
            raise OSError("relay said " + status.decode().strip())
        while (await self.reader.readline()) not in (b"\r\n", b""):
            pass
        await self._send(bytes((M_HELLO, 1, 0xE0)) + _s(self.name) + _s(""), QOS_CONFIRM)
        while True:
            payload = await self._read_frame()
            if payload and payload[0] == M_WELCOME:
                return
            if payload and payload[0] == M_ERROR:
                raise OSError("relay refused hello")

    def close(self):
        if self.writer:
            try:
                self.writer.close()
            except Exception:
                pass
        self.reader = self.writer = None

    async def subscribe(self, pattern, sub_id=1):
        await self._send(bytes((M_SUBSCRIBE,)) + struct.pack(">I", sub_id) + _s(pattern) + b"\xff\x00", QOS_CONFIRM)

    async def set(self, address, text):
        await self._send(bytes((M_SET, V_STRING)) + _s(address) + _s(text), QOS_CONFIRM)

    async def emit(self, address, text):
        await self._send(bytes((M_PUBLISH, SIG_EVENT << 5)) + _s(address) + bytes((1, V_STRING)) + _s(text), QOS_CONFIRM)

    async def ping(self):
        await self._send(bytes((M_PING,)), QOS_FIRE)

    async def _send(self, payload, qos):
        frame = struct.pack(">BBH", MAGIC, (qos << 6) | ENC_BINARY, len(payload)) + payload
        n = len(frame)
        # Client to server WebSocket frames are masked. A zero mask leaves the payload as is.
        head = bytes((0x82, 0x80 | n)) if n < 126 else bytes((0x82, 0x80 | 126)) + struct.pack(">H", n)
        self.writer.write(head + b"\0\0\0\0" + frame)
        await self.writer.drain()

    async def _read_ws(self):
        """Reads one whole binary WebSocket message, answering control frames on the way."""
        data = b""
        while True:
            h = await self.reader.readexactly(2)
            fin, op, n = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", await self.reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", await self.reader.readexactly(8))[0]
            body = await self.reader.readexactly(n) if n else b""
            if op == 0x8:
                raise OSError("relay closed")
            if op == 0x9:
                self.writer.write(bytes((0x8A, 0x80 | n)) + b"\0\0\0\0" + body)
                await self.writer.drain()
            elif op in (0x0, 0x1, 0x2):
                data = data + body if data else body
                if fin:
                    return data

    async def _read_frame(self):
        """Returns one CLASP payload, without the 4 or 12 byte frame header."""
        raw = await self._read_ws()
        if len(raw) < 4 or raw[0] != MAGIC:
            return b""
        return memoryview(raw)[12 if raw[1] & 0x20 else 4:]

    def _dispatch(self, p):
        kind = p[0]
        if kind == M_SET:
            address, i = _read_s(p, 2)
            value, _ = _read_value(p, i, p[1] & 0x0F)
            self.on_message(address, value)
        elif kind == M_PUBLISH:
            address, i = _read_s(p, 2)
            if p[i] == 1:
                value, _ = _read_value(p, i + 2, p[i + 1])
                self.on_message(address, value)
        elif kind == M_SNAPSHOT:
            count = struct.unpack_from(">H", p, 1)[0]
            i = 3
            for _ in range(count):
                address, i = _read_s(p, i)
                value, i = _read_value(p, i + 1, p[i])
                i += 8
                flags = p[i]
                i += 1
                if flags & 1:
                    _, i = _read_s(p, i)
                if flags & 2:
                    i += 8
                self.on_message(address, value)
        elif kind == M_ERROR:
            code = struct.unpack_from(">H", p, 1)[0]
            print("clasp error", code, _read_s(p, 3)[0])

    async def run(self):
        """Reads until the connection drops, which raises."""
        while True:
            p = await self._read_frame()
            if not p:
                continue
            if p[0] == M_PING:
                await self._send(bytes((M_PONG,)), QOS_FIRE)
            elif self.on_message:
                try:
                    self._dispatch(p)
                except (ValueError, IndexError) as ex:
                    print("clasp: bad message", ex)
