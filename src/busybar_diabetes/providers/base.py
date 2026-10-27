from __future__ import annotations

from typing import Protocol

from busybar_diabetes.models import GlucoseReading


class GlucoseProvider(Protocol):
    def get_reading(self) -> GlucoseReading:
        ...
