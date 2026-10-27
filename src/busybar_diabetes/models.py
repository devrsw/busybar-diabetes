from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(slots=True)
class GlucoseReading:
    value_mgdl: int
    timestamp: datetime
    trend: str | None = None
    delta_mgdl: int | None = None
    source: str = "unknown"

    def age_seconds(self, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        ts = self.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return max(0, int((now - ts).total_seconds()))
