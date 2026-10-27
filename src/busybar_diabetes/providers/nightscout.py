from __future__ import annotations

from datetime import datetime, timezone

import requests

from busybar_diabetes.models import GlucoseReading


class NightscoutProvider:
    def __init__(self, base_url: str, token: str | None = None, timeout: float = 8.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        if token:
            self.session.headers.update({"api-secret": token})

    def get_reading(self) -> GlucoseReading:
        url = f"{self.base_url}/api/v1/entries.json"
        params = {"count": 2}
        response = self.session.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        entries = response.json()
        if not entries:
            raise RuntimeError("No glucose entries returned from Nightscout")

        latest = entries[0]
        previous = entries[1] if len(entries) > 1 else None

        value = int(latest["sgv"])
        trend = latest.get("direction")
        timestamp = _parse_ns_timestamp(latest)

        delta = None
        if previous and previous.get("sgv") is not None:
            delta = int(latest["sgv"]) - int(previous["sgv"])

        return GlucoseReading(
            value_mgdl=value,
            timestamp=timestamp,
            trend=trend,
            delta_mgdl=delta,
            source="nightscout",
        )


def _parse_ns_timestamp(entry: dict) -> datetime:
    if "dateString" in entry and entry["dateString"]:
        date_string = str(entry["dateString"]).replace("Z", "+00:00")
        return datetime.fromisoformat(date_string).astimezone(timezone.utc)
    if "date" in entry and entry["date"]:
        ms = int(entry["date"])
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    raise RuntimeError("Nightscout entry missing date/dateString")
