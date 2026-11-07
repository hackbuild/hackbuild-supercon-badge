# hackbuild-supercon-badge

Apps for the 2026 Hackaday Supercon "Billboard" badge: an ESP32-S3 running MicroPython with a 9.69 inch e-paper panel in black, white and red.

Two apps go on the badge. **hack.build** shows the logo and wordmark, and it's what the badge boots to. **Capsule** is a slide show of my capsule machine that tells you how to get a coin from me.

The badge also joins WiFi and connects to a [CLASP](https://github.com/lumencanvas/clasp) relay, so a web page can switch screens, change the LEDs and send it images from anywhere.

- [Control the badge](https://hackbuild.github.io/hackbuild-supercon-badge/)
- [Preview the screens](https://hackbuild.github.io/hackbuild-supercon-badge/viewer.html)

## What's here

    art/build.py    draws every screen and reduces it to the panel's three colors
    badge/apps/     the apps, picked up by the badge's stock launcher
    badge/lib/      CLASP client, remote link and shared state
    docs/           the web controller, viewer and rendered screens (GitHub Pages)
    tools/deploy.py copies everything to the badge and hooks it into stock main.py

## Put it on a badge

Pull your badge's stock files first, because the deploy tool patches your own `main.py`:

```sh
mpremote fs cp :main.py backup-stock/main.py
```

Then create `badge/secret.local.json`. It's gitignored and only ever goes to the badge:

```json
{"ssid": "your wifi", "password": "your password", "key": "a long random string"}
```

Deploy and reset:

```sh
uv run --no-project --with mpremote python tools/deploy.py /dev/cu.usbmodem101
```

On the badge, **menu +/-** opens the menu and **user a** or **user b** opens the highlighted app. In Capsule, user a is the next slide and user b the previous one.

To go back to stock, Hackaday publishes the factory image in the [official badge repo](https://github.com/Hack-a-Day/2026-Billboard_Badge).

## Remote control

Open the controller, paste the same key and press **connect**. The key stays in your browser and is never sent. It names a private path on the relay and signs each command.

`relay.clasp.to` is a public relay, so a few things are worth knowing:

- Commands carry an HMAC-SHA256 signature and a one time nonce, so forged and replayed commands get rejected.
- Images are checked against a signed SHA-256 before they're shown.
- Traffic isn't encrypted end to end. Anyone who finds the path can read the badge's status and any image you send.
- The badge doesn't verify the relay's TLS certificate, because it has no CA bundle. The signatures protect commands, and they don't hide anything.

## Numbers

Measured on one badge:

| what | measured |
|---|---|
| full color refresh | 38 s (5.3 s send, 32.6 s panel) |
| 6 KB image over the relay | 1.8 s |
| free heap with WiFi and relay up | about 6.5 MB |

The slides change slowly because of that refresh. The default hold is 15 s, set from the controller.

## Rebuild the art

```sh
uv run --no-project --with pillow python art/build.py
```

The CLASP client in `badge/lib/hb_clasp.py` follows the wire format in `crates/clasp-core/src/codec.rs` of lumencanvas/clasp (Apache-2.0). Fonts in `art/fonts` are under the Apache-2.0 and OFL licenses from Google Fonts. The hack.build mark and slide art are mine, all rights reserved. The code is MIT.
