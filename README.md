# BusyBar Diabetes Display

> **On-device app:** [`busybar-app/`](busybar-app/) is a JavaScript app that runs on the BUSY Bar itself and reads Dexcom Share directly (username, password and region set in the bar's app settings). No computer needs to stay on. The Python version below runs on a separate machine and drives the bar over the network.

SugarPixel-inspired T1D dashboard for Busy Bar devices using Python and busylib.

It polls a glucose data source (Nightscout or Dexcom Share), renders values on Busy Bar,
and optionally plays audio alerts for urgent highs/lows or stale data.

## Features

- SugarPixel-like glanceable layout: glucose, trend, delta, age, status
- Sources:
	- Nightscout (`nightscout`)
	- Dexcom Share (`dexcom`)
- Configurable thresholds, stale timeout, poll interval
- Optional audio alert for urgent events
- `--once` mode for quick test runs

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Quick Start

1. Copy environment template:

```bash
cp .env.example .env
```

2. Edit `.env` with your Busy Bar IP and data source credentials.

3. Run continuously:

```bash
busybar-diabetes
```

4. Or run one cycle only:

```bash
busybar-diabetes --once
```

## Configuration

All values can be set in environment variables.

### Core

- `BUSYBAR_IP` (required): Busy Bar IP, example `10.0.4.20`
- `BB_PROVIDER` (default `nightscout`): `nightscout` or `dexcom`
- `BB_POLL_SECONDS` (default `15`)
- `BB_DISPLAY_MODE` (default `mgdl`): `mgdl`, `mmol`, or `both`
- `BB_UNIT` (legacy compatibility): `mg/dL`, `mmol/L`, or `both`

### Thresholds

- `BB_LOW_THRESHOLD` (default `70`)
- `BB_HIGH_THRESHOLD` (default `180`)
- `BB_URGENT_LOW_THRESHOLD` (default `55`)
- `BB_URGENT_HIGH_THRESHOLD` (default `250`)
- `BB_STALE_MINUTES` (default `10`)

### Alerts

- `BB_ALERT_SOUND_PATH` (optional): uploaded Busy Bar audio asset path, for example `urgent.wav`
- `BB_ALERT_COOLDOWN_SECONDS` (default `300`)

### Nightscout Provider

- `NS_BASE_URL` (required if `BB_PROVIDER=nightscout`): for example `https://your-site.herokuapp.com`
- `NS_TOKEN` (optional): API token if your endpoint requires it

### Dexcom Share Provider

- `DEXCOM_USERNAME` (required if `BB_PROVIDER=dexcom`)
- `DEXCOM_PASSWORD` (required if `BB_PROVIDER=dexcom`)
- `DEXCOM_OUS` (default `true`): `true` for outside US servers

## Notes

- This app mimics SugarPixel-style behavior but is not affiliated with SugarPixel.
- For Dexcom Share support, install dependency: `pip install pydexcom`

## Dev

```bash
python -m busybar_diabetes --once
```