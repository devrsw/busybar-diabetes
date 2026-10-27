from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone

from busylib import BusyBar

from busybar_diabetes.config import AppConfig
from busybar_diabetes.providers import build_provider
from busybar_diabetes.renderer import BusyBarRenderer


def run(once: bool = False) -> None:
    config = AppConfig.from_env()
    provider = build_provider(config)
    renderer = BusyBarRenderer(config)

    logging.info("Starting busybar-diabetes using provider=%s", config.provider)

    last_alert_key: str | None = None
    last_alert_at = 0.0

    with BusyBar(config.busybar_ip) as bb:
        while True:
            try:
                reading = provider.get_reading()
                stale = reading.age_seconds(datetime.now(timezone.utc)) > (
                    config.stale_minutes * 60
                )
                state = renderer.render(bb, reading, stale=stale)

                alert_key = state.status if state.urgent else None
                now_ts = time.time()
                if (
                    alert_key
                    and alert_key != last_alert_key
                    and now_ts - last_alert_at >= config.alert_cooldown_seconds
                ):
                    renderer.play_alert(bb)
                    last_alert_key = alert_key
                    last_alert_at = now_ts

                if not state.urgent:
                    last_alert_key = None

                logging.info(
                    "Reading: %s mg/dL trend=%s delta=%s age=%ss status=%s",
                    reading.value_mgdl,
                    reading.trend,
                    reading.delta_mgdl,
                    reading.age_seconds(),
                    state.status,
                )
            except Exception:
                logging.exception("Cycle failed")

            if once:
                break
            time.sleep(config.poll_seconds)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="SugarPixel-inspired T1 diabetes display for Busy Bar"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single poll/render cycle and exit",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Logging level: DEBUG, INFO, WARNING, ERROR",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    run(once=args.once)
