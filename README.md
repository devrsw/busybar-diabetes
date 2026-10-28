# Glucose

A continuous glucose display for the BUSY Bar, for people with type 1 diabetes and their followers. It runs on the bar itself and reads from Dexcom Share or Nightscout — no phone, computer or server in between.

![Glucose on a BUSY Bar: 8.4 mmol/L with a down arrow traveling in a loop, and -0.9 change](docs/screenshots/arrow-loop.png)

| View | |
| --- | --- |
| Number + delta | ![8.4 down -0.9](docs/screenshots/view-delta.png) |
| Number only | ![8.4](docs/screenshots/view-number.png) |
| Arrow only | ![A large down arrow](docs/screenshots/view-arrow.png) |
| Number + IOB | ![8.4 down 0.6U](docs/screenshots/view-iob.png) |
| Number + COB/IOB | ![8.4 down, 0g over 0.6U](docs/screenshots/view-iob_cob.png) |
| Chart (press the knob) | ![The last hour as colored dots around the high line, with 10.7](docs/screenshots/view-chart.png) |

Captured from a bar with `tools/screenshot.py`. The dotted line along the bottom fills toward the next reading.

- Big glucose value, colored by range (urgent low, low, in range, high, urgent high)
- Trend arrow (double up, up, 45° up, flat, 45° down, down, double down) that travels along its direction in a smooth loop, fading in and out; the faster glucose is changing, the faster it moves (can be turned off)
- When a new reading arrives, the value counts to it from the old one, longer for bigger jumps; a jump of 20 mg/dL or more starts with a bright flash
- Five display modes: number + delta, number only, arrow only, number + insulin on board, or number + carbs and insulin on board (IOB and COB from Nightscout)
- Change since the previous reading, at the same size as the value (it steps down a font size only if it wouldn't fit)
- A progress line along the bottom showing time toward the next 5-minute Dexcom reading: five one-minute segments, inset from the edges, that fill one pixel every 6 seconds and stay full once the reading is due
- Greys out once the reading is stale, showing its age in red in place of the change; shows `---` after an hour without data
- Status LED blinks once for each new urgent low/high reading (can be turned off)
- mg/dL or mmol/L

Not a medical device. Don't use it for treatment decisions; that's what your Dexcom receiver, app and alarms are for.

## Setup

1. Set up Dexcom Share, Nightscout, or both:
   - **Dexcom Share:** in the Dexcom app, turn on **Share** and invite at least one follower. Share's servers only serve data for accounts that share.
   - **Nightscout:** any Nightscout site. If it isn't publicly readable, create an access token: Admin Tools → Subjects → Add new subject with the `readable` role, then copy the token shown next to it (it looks like `bar-1a2b3c4d5e6f7a8b`). The API secret is not supported.

   With both, Dexcom supplies glucose and Nightscout takes over whenever Dexcom isn't working: an error, a rejected login, no data, or a reading older than the stale limit. Nightscout also supplies carbs and insulin on board for the COB/IOB display mode.
2. Install the app: download the `.tgz` from [Releases](https://github.com/devrsw/busybar-diabetes/releases), or build it (below). Safari may unpack the download into a `.tar`; that installs just the same. Installing over an older version normally keeps your settings, but the bar's firmware has been seen to reset them during an install; if the app shows `Set Dexcom/NS` afterwards, enter them again. If an install fails while Glucose is running, quit it first.
3. On the BUSY Bar, open **APPS → Glucose** settings and fill them in with the bar's own controls. Every setting can be changed on the bar; the bar's Web UI works too.

| Setting | |
| --- | --- |
| Dexcom Share → Username | The Dexcom account of the person wearing the sensor (not a follower's). Username, email, or phone number with `+` and country code. |
| Dexcom Share → Password | That account's password. Stored on the bar, masked in the UI. |
| Dexcom Share → Region | **United States**, **Outside US**, or **Japan**: where that Dexcom account was created. |
| Nightscout → URL | Your site, e.g. `https://my-site.herokuapp.com` (`https://` is added if left out) |
| Nightscout → Access token | Only if the site needs one, e.g. `readable-1a2b3c4d5e6f7a8b` |
| Display → Display mode | **Number + delta** (default), **Number only**, **Arrow only** (a larger arrow; shows the number while the reading is stale or has no trend), **Number + IOB** (insulin on board in the delta's place, e.g. `0.8U`), or **Number + COB/IOB**: carbs on board over insulin on board, from Nightscout (`/api/v2/properties`, so it works with Loop, AAPS, OpenAPS or logged treatments). The IOB modes need a Nightscout URL, even when Dexcom supplies glucose; without one they show the delta instead. Shows `--U` / `--g` if Nightscout can't be read (check the token). |
| Display → Units | mg/dL or mmol/L |
| Display → Stale after | Minutes before the reading greys out (default 15) |
| Display → Animate trend arrow | Loop the arrow along its direction (default on). One pass takes 3.2 s when flat, 2.4 s at 45°, 1.6 s for a single arrow and 1.1 s for a double arrow, following Dexcom's rate bands (under 1, 1–2, 2–3 and over 3 mg/dL per minute). |
| Ranges | Urgent low / low / high / urgent high in mg/dL (55 / 70 / 180 / 250), and whether the LED blinks when urgent |
| Colors | One color per range, picked from a list (red, orange, amber, yellow, green, teal, cyan, blue, purple, pink, white) |

Settings are re-read every time the app polls, so changes take effect within a few minutes; opening the chart with the knob also re-reads them right away.

## Controls

| Control | |
| --- | --- |
| **Turn the knob** | Next or previous view. Its name shows for a moment, with dots marking where it is in the list. The IOB views are skipped when no Nightscout URL is set. |
| **Press the knob** | Open or close a chart of the last hour: a dot per reading in its range color, dotted lines at your low and high thresholds, and the current value. The scale fits the readings, so small swings show. While it is open the app fetches the hour's readings. |
| **Hold the knob** (0.6 s) | Switch between mg/dL and mmol/L |
| **Start** | Same as pressing (or holding) the knob |
| **Back** | Quit |

Apps can read their settings but not change them, so the view and units you pick with the knob are remembered on the bar separately. If you later change Display mode or Units in the settings, that change wins.

## Screen messages

| Message | Meaning |
| --- | --- |
| `Set Dexcom/NS` | Neither a Dexcom login nor a Nightscout URL is set |
| `Bad login` | Dexcom rejected the username/password, or the region is wrong. The app waits 10 minutes before trying again, so it doesn't lock the account |
| `Dexcom locked` | Too many failed logins; Dexcom has locked the account for a while |
| `No data` | Logged in, but no readings (Dexcom: in the last 24 hours; is Share on?) |
| `Set NS token` / `Bad NS token` | The Nightscout site refused the request: it needs a token, or the token is wrong |
| `Bad NS URL` | Nothing that looks like Nightscout at that URL |
| `No connection` | The source couldn't be reached; retries with backoff from 30 s up to 5 min |

## How it polls

Dexcom sensors produce a reading every 5 minutes. The app asks Share for the two newest readings, then sleeps until 20 seconds after the next one is due. If it hasn't arrived yet it asks again every 30 seconds. That's about one request every 5 minutes in normal use.

While Nightscout is supplying glucose it is checked every minute, since it has no login to lock and may carry 1-minute data from other sensors. After Dexcom rejects a login, the app leaves Dexcom alone for 10 minutes (so the account doesn't get locked) and uses Nightscout meanwhile.

The arrow loop is a native animation the bar plays by itself, like the stock Weather app's icons, so it costs no requests. The animations are pre-rendered for every arrow, size and color option by `tools/make_arrow_anims.py` into `src/animations/`; run it again after changing arrow shapes, colors or timing. The value's count to a new reading is drawn by the app, a few frames a second for up to 2.2 seconds.

## Building with Node 26

The BUSY build tooling needs Node 24 (Node 26 breaks it). Without nvm/fnm, run the scripts through npx:

```sh
npx -p node@24 npm run build
npx -p node@24 npm run app:install -- --addr <bar-ip>
npx -p node@24 npm run app:run -- --addr <bar-ip>
```

## Code

| File | |
| --- | --- |
| `src/main.ts` | Poll scheduling, backoff, drawing only changed elements, input |
| `src/reading.ts` | The reading type and trend parsing shared by both sources |
| `src/dexcom.ts` | Dexcom Share client (login, session renewal, readings) |
| `src/nightscout.ts` | Nightscout client (entries API, optional access token) |
| `src/display.ts` | Screen layout, range colors, trend arrow bitmaps and directions |
| `src/motion.ts` | The value's count to a new reading |
| `src/controls.ts` | Knob order of the views, and remembering knob choices |
| `src/animations/` | Generated arrow loop animations |
| `tools/make_arrow_anims.py` | Generates the arrow animations (`.anim`, the bar's native format) |
| `tools/screenshot.py` | LED-style screenshots and animated captures from a bar |
| `src/config.ts` | Reads the settings with defaults |
| `src/appmeta/settings.json` | The settings screen |

## Getting started

```sh
npm install
npm run build         # build the app into dist/app.glucose.tgz
npm run app:install   # install it on the BUSY Bar connected over USB
npm run app:run       # launch the installed app
```

The app's id is `app.glucose`, set in `src/appmeta/manifest.json`. An id is `<namespace>.<app>`, at most 32 characters, made of Latin letters, digits, underscores, dashes, and dots, and not starting with a dot. If yours still says `app.example`, change it to your own namespace before publishing.

## Layout

`src/` is the app — everything in it is yours to edit.

The entry point is `src/main.ts` (or `src/main.js`). The name is fixed: the build turns it into `scripts/main.js`, the file the BUSY Bar starts. Any imported modules are emitted as separate files alongside it in `scripts/`, unless `npm run build -- --bundle` inlines them.

`src/main.ts` is run from top to bottom, not imported: it starts the app by calling `main()` at the end and must not export anything. Imported modules can use standard exports.

```
my-app/
├── src/                          the app
│   ├── main.ts                   the entry point: function main(), called at the end
│   ├── appmeta/
│   │   ├── manifest.json         id, name, version, api_version
│   │   ├── settings.json         the settings screen — optional
│   │   ├── icon_front_8x8.png    front icon, 8×8 color — optional
│   │   └── icon_back_11x11.png   back icon, 11×11 grayscale — optional
│   ├── images/
│   ├── animations/
│   └── sounds/
├── shared/                       app-level helpers, imported as @shared/*
```

Both icons are optional; without them a default is used.

## Resources

Anything in `src/` that isn't a source file is copied into the package, sorted by what the BUSY Bar can read:

| Extension | Destination |
| --- | --- |
| `.png` `.image` | `images/` |
| `.anim` | `animations/` |
| `.snd` | `sounds/` |
| anything else | `resources/` |

A file in `src/images`, `src/animations` or `src/sounds` keeps its folder as long as the BUSY Bar reads its format.

`images/`, `animations/` and `sounds/` hold only those formats. An image, animation or sound in another format — `.jpg`, `.gif`, `.svg`, `.wav`, `.mp3` and the like — goes to `resources/`, and the build warns that the device cannot read it.

Everything the app draws goes through the layout helpers in `@busy-app/busy-lib`: build a tree out of `row` / `column` / `stack`, hand it to `render()`, and send the result with `device.DisplayDraw()`. The screen is 72×16 pixels.

## Input

`listen("input", handler)` delivers the device keys: `ok`, `start` and `back` with a `press` / `release` / `short` / `long` / `repeat` action, and `encoder` with a `delta` of `1` or `-1`. It returns an unbind function.

Use `short` as the default action for a button press: it fires once, after a normal press and release. `press` fires immediately on key down and is followed by `short`, so handling `press` as a tap can react twice. Use `long` and `repeat` for hold gestures.

## Commands

| Command | Description |
| --- | --- |
| `npm run build` | empties `dist/` and builds the package into `dist/app.glucose.tgz` |
| `npm run build -- --emit dir` | leaves the `app.glucose/` folder instead of the `.tgz` |
| `npm run build -- --emit both` | leaves the folder and the `.tgz` |
| `npm run build -- --out <path>` | builds into `<path>` instead, replacing only this app's package there |
| `npm run build -- --tgz-name <name>` | names the `.tgz`, e.g. `"{id}-{version}.tgz"` |
| `npm run build -- --no-minify` | readable output, for debugging |
| `npm run build -- --bundle` | inlines every module into one `main.js` |
| `npm run build -- --addr <host>` | sets the BUSY Bar address the app connects to, `localhost` by default |
| `npm run typecheck` | type-checks the app |
| `npm run app:install` | installs `dist/app.glucose.tgz` on the BUSY Bar; build it first with `npm run build` |
| `npm run app:uninstall` | removes the app from the BUSY Bar, keeping its settings |
| `npm run app:run` | launches the installed app |
| `npm run app:stop` | quits the running app |

The four `app:` commands talk to the BUSY Bar connected over USB. For a device connected over Wi-Fi, pass `--addr <host>` with its network IP address or hostname, and `--password <password>` if password protection is enabled:

```sh
npm run app:install -- --addr <host>
npm run app:install -- --addr <host> --password <password>
```

## Build output

The package folder is named after the app id:

```
dist/
└── app.glucose/
    ├── appmeta/manifest.json
    ├── scripts/main.js
    └── images/ animations/ sounds/ resources/
```

By default the build packs that folder into `dist/app.glucose.tgz`, with the folder itself at the root of the archive, and removes the folder; `--emit dir` keeps only the folder, `--emit both` keeps both. `--tgz-name` gives the archive another name; `{id}` and `{version}` in it are replaced with the manifest values.

## Manifest

`src/appmeta/manifest.json` carries the app's identity and a couple of knobs (see the [apps documentation](https://github.com/busy-app/busybar-firmware/blob/dev/documentation/JavaScript%20Applications.dox.md)):

| Field | Description |
| --- | --- |
| `format_version` | manifest format, `1` — required |
| `id` | up to 32 characters — required |
| `name` | display name — required |
| `version` | semver, e.g. `1.0.0` — required |
| `api_version` | minimum BUSY Bar HTTP API version the app needs, e.g. `27.12.0` — required |
| `description`, `author` | free form, default `""` |
| `heap_size_kib` | memory for the app heap, 1–512, default 128 |
| `debug` | when true, shown only in developer mode, default false |

Raise `heap_size_kib` if the app runs out of memory.

## Node version

The app builds on Node 24 — the version in `.nvmrc` and the range `engines` allows. Node 26 breaks the build and is excluded. With `fnm` or `nvm` installed, `fnm use` / `nvm use` picks the right one up from `.nvmrc`.

## Settings

To give the app a settings screen, add `src/appmeta/settings.json` describing the fields, then read the stored values:

```ts
import { loadValues } from "@shared/settings";

const values = await loadValues();
```

`loadValues()` returns `null` when nothing is stored yet — use the defaults.
