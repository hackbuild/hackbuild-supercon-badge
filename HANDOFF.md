# supercon badge, handoff

## what it is

Apps and crowd games for the 2026 Hackaday Supercon "Billboard" badge. The badge keeps Hackaday's
stock MicroPython firmware and gains four apps: hack.build, Capsule, Sent and Play. Phones are the
controllers, one host page runs the games, the badge is the public screen, and everything meets on
relay.clasp.to. `docs/how.html` is the one page explanation with a diagram.

## deployments

| what | where |
|---|---|
| site | https://supercon.hack.build (GitHub Pages from `docs/`, HTTPS enforced) |
| old address | https://hackbuild.github.io/hackbuild-supercon-badge/ redirects to the site |
| DNS | CNAME `supercon` to `hackbuild.github.io` in the hack.build zone on Netlify DNS, not DigitalOcean |
| repo | https://github.com/hackbuild/hackbuild-supercon-badge |
| capsule machine | `../hackbuild-capsule-machine`, accepts coins from both addresses |
| relay | wss://relay.clasp.to, room `/hb/play/695S`, badge path `/hb/badge/<hash of key>` |

Every push to main publishes the site in about 40 s. The room code comes from the badge key and is
written into `docs/lib/protocol.js` as `HOME_ROOM`, so the home page play button and a bare `/play`
link land there. A new key needs a new `HOME_ROOM`.

## secrets, never committed

- `badge/secret.local.json`: wifi networks and the badge key. Only goes to the badge and to the
  tools that read it locally.
- `../hackbuild-capsule-machine/firmware/capsule/secret.h`: `CREDIT_KEY` and the PIN.
  `tools/credit_key.py` writes the key.
- The Netlify CLI login on this Mac reaches the hack.build zone. doctl's `moheeb` context does not
  hold hack.build.

## put it on the badge

```sh
uv run --no-project --with mpremote --with qrcode --with pillow python tools/deploy.py /dev/cu.usbmodem101
uv run --no-project --with mpremote mpremote connect /dev/cu.usbmodem101 reset
```

The port moves between `usbmodem101` and others when the badge goes through a hub. `mpremote devs`
lists it as 303a:4001. After a soft reset the stock driver's hardware SPI does not draw (official
issue #25), so scripts that touch the panel run with `mpremote resume run` against a running badge.

## checking it

- `node --test tools/test/rules.test.mjs`: 26 rule tests, all pass.
- `cd tools/loadtest && node hw-check.mjs` drives the real badge through `docs/lib/badge.js`: Play,
  LED countdown, an endless reel, buttons. `node hw-check.mjs live`, `stream` and `bigreel` time
  live screens, streamed frames and a worst case 229 kB gif reel. These send to the badge, so they
  cut into a host page's transfer if one is running.
- `node tools/loadtest/relay-watch.mjs 45` listens read only to the room and the badge path.
- `tools/loadtest/badge-emu.mjs` stands in for the badge; `loadtest.mjs` simulates phones.

## where it stands, 2026-11-10

Measured on the badge:

| what | measured |
|---|---|
| change-only frame, booster kept on | 355 to 366 ms, about 2.8 fps |
| gif reel frame, file load included | about 0.44 s |
| clean pass, shipped short table | 4.3 s |
| full color refresh | 32.6 s |
| live screen sent in chunks, before change-only frames | about 3.4 s end to end, 1.9 s of it the transfer |

Checked on hardware: Play, join screen, LED countdown (seen by the owner), reels, endless loops and
interrupts, live screens, streamed frames, change-only frames, a 229 kB reel.

Not checked yet:

- the arcade end to end: EmulatorJS booting in the host page, phone pads reaching it, frames on the
  badge. The phone pads were looked at in Chrome at desktop width only.
- user a and user b reaching the host (no press came in during the tests)
- the host fix for gifs that would not send (commit c2c1b3f): the owner needs to reload the host
  page and try a gif
- what change-only frames look like: ghosting and how dark black gets
- the capsule firmware is built (654 KB) but not flashed; Web NFC never tried on a phone
- the dither booth with a real camera

## open items

- Snake and pixel commons screens still travel as chunked transfers, about 2 s each. Streaming them
  like arcade frames (`/fr`) would bring them near 0.4 s.
- MicroPython adds about 120 ms a frame on top of the 237 ms pull. badge os, in C, adds about 35 ms.
  The split, the plane copy in `_remember()` and the bit-banged register writes are the places to
  look.
- Flash snipe's badge model goes into the public stage record, so the code is readable on the relay
  before the badge draws it.
- No per phone rate limit on `in/<pid>`.
- The Smash rom link on doot's Space does not allow supercon.hack.build; pick the file instead, or
  add the origin to that Space's CORS.
- Switching away from the arcade leaves EmulatorJS running until the host page reloads.
- `tools/lint-voice.mjs` is not in this repo; voice rules were checked by hand and with grep.

## upstream

The official repo takes apps under `user_apps/` and infrastructure in separate PRs. This project is
listed there as `user_apps/hackbuild_crowd_games/`, a README that links here. The change-only frame
follows badge os's calm frame (github.com/yigitabi5444/supercon26-badge-os, GPL-2.0), rewritten from
its description; none of its code is here.
