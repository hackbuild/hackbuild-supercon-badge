# hackbuild-supercon-badge

Apps for the 2026 Hackaday Supercon "Billboard" badge: an ESP32-S3 running MicroPython with a 9.69 inch e-paper panel in black, white and red.

Two apps go on the badge. **hack.build** shows the logo and wordmark, and it's what the badge boots to. **Capsule** is a slide show of my capsule machine that tells you how to get a coin from me.

The badge also joins WiFi and connects to a [CLASP](https://github.com/lumencanvas/clasp) relay, so a web page can switch screens, change the LEDs and send it images from anywhere.

- [Control the badge](https://hackbuild.github.io/hackbuild-supercon-badge/)
- [Host crowd games](https://hackbuild.github.io/hackbuild-supercon-badge/host)
- [Preview the screens](https://hackbuild.github.io/hackbuild-supercon-badge/viewer.html)

## What's here

    art/build.py    draws every screen and reduces it to the panel's three colors
    badge/apps/     the apps, picked up by the badge's stock launcher
    badge/lib/      CLASP client, remote link and shared state
    docs/           the web controller, games host, player page, viewer (GitHub Pages)
    docs/lib/       relay connection, badge link and the game rules
    tools/deploy.py copies everything to the badge and hooks it into stock main.py
    tools/loadtest/ simulated phones for the crowd games

## Crowd games

Four games from the PLACARD design, where the phones are the live controllers and the badge is a slow public billboard:

- **pixel commons**: a shared 36 by 24 canvas. Ink refills over time, and the badge prints the canvas every 20 s.
- **the hill**: write a quip, then vote head to head against the quip on the badge. The winner takes the badge.
- **flash snipe**: every redraw puts a new code on the badge. The first claims score most.
- **snake by committee**: the room votes every move.

`host.html` runs on the wearer's phone with the badge key. It is the only writer of game state, keeps the screen awake, saves the room in the browser so a reload carries on, and sends the badge a new screen each time the last one has finished drawing. People join at `/play#ROOM` from the QR on the badge. The room code comes from the key, so a printed QR keeps working.

Built on the lessons from running doot with 145 phones on the same relay:

- Phones write only their own input, at `/hb/play/ROOM/in/ID`, and the host answers each one on that phone's own address. No list of players goes to every phone.
- Presence is a payload-free heartbeat judged by when it arrives. No two clocks are ever compared, and timers go out as time left, never as a time of day.
- Missing a heartbeat never takes anything away from a player. A host that goes quiet shows as "host away", and moves wait for it.
- The relay connection rebuilds itself with jittered backoff that never gives up, restores every subscription, and renews a session the relay has gone quiet on.
- The host republishes state every 20 s even when nothing changed, because a dropped send is silent.
- The game clock runs in a worker, because a browser throttles timers on a page it thinks nobody is looking at.

Measured with `tools/loadtest`, 150 simulated phones on relay.clasp.to, one socket each, joining 10 at a time:

| game | phones | drops while playing | host reply p50 | host reply p95 | messages per phone |
|---|---|---|---|---|---|
| snake | 150 | 0 | 345 ms | about 1.1 s | 1.5 a second |
| the hill | 150 | 0 | 330 ms | about 1.0 s | 0.7 a second |
| pixel commons | 150 | 0 | 321 ms | about 0.9 s | 2.4 a second |

Not tested yet: flash snipe needs the badge to draw its codes, and the badge screens were only rendered in the browser, not sent to the panel during a load test. An iPhone pauses the host page when the screen locks, so keep the host page open.

## Put it on a badge

Pull your badge's stock files first, because the deploy tool patches your own `main.py`:

```sh
mpremote fs cp :main.py backup-stock/main.py
```

Then create `badge/secret.local.json`. It's gitignored and only ever goes to the badge:

```json
{"networks": [{"ssid": "your wifi", "password": "your password"}], "key": "a long random string"}
```

List as many networks as you like. The badge tries the ones it can see, strongest first, then the rest by name, since a phone hotspot often stays out of scans. It only speaks 2.4 GHz, so an iPhone hotspot needs **Maximize Compatibility** on.

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
- The relay only counts messages it forwards to a client as activity, and drops subscriptions after 300 s without any. So the badge renews its session every 240 s when idle, and an open controller page sends a heartbeat. A command sent during a renewal is retried by the page.
- The badge doesn't verify the relay's TLS certificate, because it has no CA bundle. The signatures protect commands, and they don't hide anything.

## Numbers

Measured on one badge:

| what | measured |
|---|---|
| fast refresh, black and white | 4.3 s (3.5 s of it is the panel's waveform) |
| first fast refresh after boot | 6.7 s, reads the panel's calibration once |
| full color refresh | 32.6 s, was 38 s before the hardware SPI send |
| loading a screen file | about 110 ms |
| 6 KB image over the relay | 1.8 s |
| free heap with WiFi and relay up | about 6.5 MB |

Fast mode uses the short waveform Hackaday ships in `data/rendered_luts.py`. It has no red, so red draws as black, and every 30th screen gets a full color refresh to clean the film. The default hold is 8 s, set from the controller.

## Rebuild the art

```sh
uv run --no-project --with pillow python art/build.py
```

The CLASP client in `badge/lib/hb_clasp.py` follows the wire format in `crates/clasp-core/src/codec.rs` of lumencanvas/clasp (Apache-2.0). Fonts in `art/fonts` are under the Apache-2.0 and OFL licenses from Google Fonts. The hack.build mark and slide art are mine, all rights reserved. The code is MIT.
