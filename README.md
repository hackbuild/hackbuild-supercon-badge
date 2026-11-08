# hackbuild-supercon-badge

Apps and crowd games for the 2026 Hackaday Supercon "Billboard" badge: an ESP32-S3 running MicroPython with a 9.69 inch e-paper panel in black, white and red.

The badge shows my hack.build logo and a slide show of my capsule machine. Then it turns into a screen for a room full of people. Phones are the controllers, the badge is the slow public billboard, and a projector view handles the big room.

- [Play](https://supercon.hack.build/play) with your phone. The badge's QR code takes you there with the room filled in.
- [Host crowd games](https://supercon.hack.build/host) from the wearer's phone.
- [Control the badge](https://supercon.hack.build/): logo, slides, messages.
- [Preview the screens](https://supercon.hack.build/viewer.html) without a badge.
- [How it works](https://supercon.hack.build/how.html), on one page with a diagram.

## The games

Nine games and a meme GIF mode, each built for anywhere from one person to a room of a hundred or more.

| game | what you do | how the badge keeps up |
|---|---|---|
| the hill | answer a prompt, then pick the funnier of pairs of answers. The winner goes on the badge and the next prompt starts on its own | one screen per phase |
| name that package | a real footprint shows up. Type its name. First right answer wins a capsule credit, and the reveal shows the pinout | one screen per question |
| live ink | everyone draws on one page | strokes stream to the badge, which draws them itself and refreshes about every 0.36 s |
| pixel commons | a shared pixel canvas with a prompt, and ink that refills | one quick pass when it changed, batched every few seconds |
| 2 fps cinema | draw one frame of a 12 frame loop, with the frame before yours showing faintly | full reels play on the badge as a flip book |
| dither booth | take an opt in selfie, dithered for e-paper. The room votes one onto the badge | one portrait at a time |
| flash snipe | every redraw shows a new code. First claims score most | a code goes live once the badge has drawn it |
| snake by committee | the room votes every move. A turn ends once half the room agrees, so a few people steer it live | one quick pass per turn |
| meme gifs | the wearer taps a GIF, pastes a link or picks a file. A link joins the GIF library, and phones ask for the next one from the presets and the library | ten frames at 480 by 336 loop on the badge until the next GIF, a frame every 0.44 s |
| retro arcade | the host loads a rom and EmulatorJS runs it in the host page. Your phone is the controller, laid out like the console's own. The room can share one controller or split into up to four players | frames stream to the badge, which draws the newest one, about 0.36 s each |

Name That Package came out of my [hackbuild-fab](https://github.com/hackbuild/hackbuild-fab) parts workflow. `tools/parts/build.py` pulls 38 footprints from the KiCad library mirror on GitHub, Espressif's KiCad library and the hbf catalog, and the pin names from KiCad's current symbols, so the pinout on a reveal is the one KiCad ships. Supercon favorites are in there: the Z80 and the 1802 in DIP-40, the CH32V003, the Blue Pill chip, the RP2040, ESP32 modules, a WS2812B, a Pi header and a USB-C receptacle. While a game runs, the host can search KiCad's library and add more footprints on the spot.

The game ideas come from my PLACARD design study for this badge. The meme GIF presets are links to GIPHY; the GIFs load from GIPHY when played and none are stored here.

## Capsule credits

Win at Name That Package, or at The Hill if the host turns it on, and you get a credit for my capsule machine.

1. The host seals the credit to your phone's key, so nobody watching the relay can copy it.
2. On Android Chrome, press **load it onto a coin** and hold a blank NFC coin to your phone. Web NFC writes the credit onto it.
3. Tap the coin on the capsule machine. It checks the signature, records the credit as spent, turns the coin back into a regular hack.build coin, and drops a capsule.

iPhones don't have Web NFC, so the phone shows a short code instead. Show it to me and I'll hand you a coin.

The machine needs the credit key in its `secret.h`. `python3 -I tools/credit_key.py ../hackbuild-capsule-machine/firmware/capsule/secret.h` writes it there.

## Hosting

Open the host page on the phone you'll carry, or a laptop by the stage. Paste the badge key once and it stays in that browser.

- Install it as an app. On Android Chrome or a desktop browser, open **setup** on the host page and press **install as an app**. On an iPhone, open it in Safari, press share, then **Add to Home Screen**. The app opens straight to the host page, with shortcuts to play, projector and badge control. An installed app on iOS keeps its own storage, so paste the key once more inside it.
- Keep the host page open with the screen on. It holds a wake lock, but iOS still pauses a page when the phone locks.
- Open **projector view** for the room. It shows the game large and in color, the join QR and the leaderboard.
- The room code comes from the badge key, so a QR you print keeps working all weekend.
- The page you opened last owns the room. Any other host page stops itself and offers to take over.
- User a and user b on the badge run the game's two main controls, like ending a phase or skipping a prompt, so you can run a game with your hands free. The host page labels which is which.
- The LED bar drains over each phase, and flashes when live ink lands, so the room can see the badge is working.
- For the retro arcade, load a rom from a link or a file on the arcade panel. EmulatorJS runs on the host device and plays the sound there, so a laptop by the stage beats a phone for N64. A rom link only loads if its server allows supercon.hack.build to fetch it; otherwise pick the file. Play only homebrew or games you own.
- Nothing a stranger types or uploads reaches the badge unfiltered. Text goes through a word filter. Photos wait in your approval queue. **remove** takes a player out of every game.

## How it holds up with a crowd

I learned these from running doot with 145 phones on the same relay, and every one of them is in `docs/lib/host-engine.js`:

- The host is the only writer of game state. Phones write only their own input, and each phone gets its private state on its own address. No list of players goes to every phone.
- Presence is a heartbeat judged by when it arrives. No two clocks are ever compared, and timers go out as time left.
- A phone that goes quiet loses nothing. A phase ends early once everyone here is done, never because someone's phone slept.
- Every send can vanish, so the host republishes state every 20 s.
- The relay connection rebuilds itself and never gives up, and renews a session the relay went quiet on.
- The game clock runs in a worker, because browsers throttle pages they think nobody is looking at.

Measured with `tools/loadtest`, simulated phones on relay.clasp.to, one socket each:

| game | phones | drops while playing | host reply p50 | host reply p95 |
|---|---|---|---|---|
| the hill | 100 | 0 | 377 ms | 580 ms |
| snake | 150 | 0 | 345 ms | about 1.1 s |
| pixel commons | 150 | 0 | 321 ms | about 0.9 s |

`node --test tools/test/rules.test.mjs` plays the rules through one person alone, two people and 120 people.

`tools/loadtest/hw-check.mjs` drives the real badge through the site's own `badge.js`: wake into Play, an LED countdown, an endless reel, live screens, a streamed frame test and the two buttons. `node hw-check.mjs live` or `node hw-check.mjs stream` picks a test.

`tools/loadtest/badge-emu.mjs` stands in for the badge on the relay. It checks signatures and nonces the way the firmware does, acks chunks in order, inflates every frame and writes what the badge would show as PNGs, so the host pages can be tested with the badge in a drawer.

## What's here

    art/build.py        draws every slide and reduces it to the panel's three colors
    badge/apps/         hack.build, Capsule, Sent, and Play for the games
    badge/lib/          CLASP client, remote link, fast refresh, live ink
    docs/               the pages, served by GitHub Pages at supercon.hack.build
    docs/how.html       how it all fits together, on one page
    docs/lib/           relay connection, badge link, host engine, sealing, credits, drawing kit
    docs/games/<id>/    rules.js on the host, screen.js for badge and projector, phone.js for players
    docs/parts/         the footprints and pinouts, CC-BY-SA 4.0 from KiCad
    docs/sw.js          the service worker: network first, so a deploy shows up on the next load
    docs/manifest.webmanifest, docs/icons/   what makes the site installable
    tools/deploy.py     copies everything to the badge and hooks it into stock main.py
    tools/icons.py      draws the app icons
    tools/parts/        builds the parts deck from KiCad
    tools/loadtest/     simulated phones and a stand-in badge
    tools/test/         rule tests

Adding a game is a folder in `docs/games` and an entry in `docs/games/registry.js`.

## Put it on a badge

Pull your badge's stock files first, because the deploy tool patches your own `main.py`:

```sh
mpremote fs cp :main.py backup-stock/main.py
```

Then create `badge/secret.local.json`. It's gitignored and only ever goes to the badge:

```json
{"networks": [{"ssid": "your wifi", "password": "your password"}], "key": "a long random string"}
```

List as many networks as you like. The badge tries the ones it can see first, then the rest by name, since a phone hotspot often stays out of scans. It only speaks 2.4 GHz, so an iPhone hotspot needs **Maximize Compatibility** on.

Deploy and reset:

```sh
uv run --no-project --with mpremote --with qrcode --with pillow python tools/deploy.py /dev/cu.usbmodem101
```

On the badge, **menu +/-** opens the menu and **user a** or **user b** opens the highlighted app. To go back to stock, Hackaday publishes the factory image in the [official badge repo](https://github.com/Hack-a-Day/2026-Billboard_Badge).

## Remote control and the relay

The key names a private path on the public relay and signs every command with HMAC-SHA256 and a one time nonce. Screens and reels travel in 16 KB chunks, three in flight, acked in order, written beside the old file and swapped in. Images are checked against a signed SHA-256.

Two streams skip the round trip. Live ink batches and arcade frames are signed and numbered, so the host never waits on the badge. For frames the badge keeps only the newest one, scales the 240 by 168 picture up four times and draws it as soon as the panel is free.

The Play app draws in one of these modes:

| mode | what it does |
|---|---|
| join | the join screen with the room's QR code |
| frame | one screen, clean three pass refresh |
| live | one screen in a quick pass, booster kept on. Snake and pixel commons use it |
| ink | strokes drawn on the badge as they arrive |
| stream | arcade frames, newest first |
| reel | a flip book of frames, looped a set number of times or until the next one |

Every quick mode cleans the panel every 40 frames, and once updates stop for 4 s.

The game rooms are public by design, so a few things are worth knowing. Anyone with the room code can read the game state. Photos and credits are sealed with ECDH and AES-GCM, so only the host opens a photo before it's approved, and only the winner's phone opens a credit. The badge doesn't verify the relay's TLS certificate, because it has no CA bundle.

## Numbers

Measured on one badge:

| what | measured |
|---|---|
| fast refresh, three passes | 4.3 s |
| one quick pass, booster kept on | 1.25 s |
| one change-only frame, booster kept on | 355 to 366 ms |
| a reel frame, change-only, file load included | about 0.44 s |
| a 10 frame GIF over the relay | under 1 s, three 16 KB chunks in flight |
| full color refresh | 32.6 s |
| loading a screen file | about 110 ms |
| 6 KB image over the relay | 1.8 s |
| a live screen, from send to drawn | about 3.4 s, 1.9 s of it the transfer |
| streamed arcade frames | one every 0.36 s, about 2.8 a second |

Fast mode uses the short waveform Hackaday ships in `data/rendered_luts.py`. It has no red, so red draws as black. Live ink and reels run single passes with the booster left on between them, then a clean three pass refresh when things go quiet.

Where the time goes: the shipped table drives every pixel for about 1 s on every pass, so the whole panel flashes. Sending a frame takes tens of milliseconds.

Quick frames are change-only, after [badge os](https://github.com/yigitabi5444/supercon26-badge-os) by yigitabi5444, which first got 3.5 to 4 frames a second out of this panel. The panel picks a waveform table per pixel from its two memory planes. With what the film shows now in one plane and the new frame in the other, only pixels that change get driven: white to black on VDH, black to white on VDL, everything else at ground. The table is ten one-frame groups, so a pull takes about 0.24 s, and the panel swaps its planes after each pull, so the next frame only sends one plane. Nothing flashes. Erased ink leaves a light ghost, which the clean pass every 40 frames takes off. The code in `badge/lib/hb_fast.py` is written from that description; badge os itself is GPL-2.0 and none of it is copied here. The official repo's `lib/epd_partial.py` does the same with 20 frames.

The pigment sets the floor. Milliseconds aren't possible on e-paper; a third of a second is about what this film does with a clean-looking change.

## Credits and licences

The CLASP client in `badge/lib/hb_clasp.py` follows the wire format in lumencanvas/clasp (Apache-2.0). The arcade loads [EmulatorJS](https://emulatorjs.org) (GPL-3.0) from its CDN at run time; none of it is copied here. GIFs are parsed with gifuct-js (MIT), also from a CDN. Footprints and pin names in `docs/parts` come from the KiCad libraries and Espressif's KiCad libraries, CC-BY-SA 4.0 with the KiCad design exception. Fonts in `art/fonts` are Apache-2.0 and OFL from Google Fonts. The hack.build mark and slide art are mine, all rights reserved. The code is MIT.
