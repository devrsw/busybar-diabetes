from __future__ import annotations

from datetime import datetime, timezone

from busybar_diabetes.models import GlucoseReading

try:
    from pydexcom import Dexcom
except Exception:  # pragma: no cover - optional dependency
    Dexcom = None  # type: ignore[assignment]


class DexcomShareProvider:
    def __init__(self, username: str, password: str, ous: bool = True):
        if Dexcom is None:
            raise RuntimeError(
                "pydexcom is required for Dexcom provider. Install with: pip install pydexcom"
            )
        self.dexcom = Dexcom(username=username, password=password, ous=ous)
        self._last_value: int | None = None

    def get_reading(self) -> GlucoseReading:
        reading = self.dexcom.get_current_glucose_reading()
        if reading is None:
            raise RuntimeError("Dexcom returned no reading")

        value = int(_coerce_attr(reading, ["mg_dl", "value", "glucose_value"]))
        trend = _coerce_attr(reading, ["trend_arrow", "trend", "trend_description"])
        dt = _coerce_attr(reading, ["datetime", "timestamp", "date"])
        timestamp = _to_utc_datetime(dt)

        delta = None
        if self._last_value is not None:
            delta = value - self._last_value
        self._last_value = value

        return GlucoseReading(
            value_mgdl=value,
            timestamp=timestamp,
            trend=str(trend) if trend is not None else None,
            delta_mgdl=delta,
            source="dexcom",
        )


def _coerce_attr(obj: object, names: list[str]) -> object | None:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    return None


def _to_utc_datetime(value: object | None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return datetime.now(timezone.utc)
