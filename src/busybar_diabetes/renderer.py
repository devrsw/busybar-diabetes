from __future__ import annotations

from dataclasses import dataclass

from busylib import BusyBar

from busybar_diabetes.config import AppConfig
from busybar_diabetes.models import GlucoseReading


@dataclass(slots=True)
class RenderState:
    urgent: bool
    status: str


class BusyBarRenderer:
    def __init__(self, config: AppConfig):
        self.config = config

    def render(self, bb: BusyBar, reading: GlucoseReading, stale: bool) -> RenderState:
        age_minutes = reading.age_seconds() // 60
        trend = _trend_to_symbol(reading.trend)
        glucose_text = _format_glucose(reading.value_mgdl, self.config.display_mode)

        if reading.delta_mgdl is None:
            delta_text = "--"
        else:
            delta_text = f"{reading.delta_mgdl:+d}"

        status = _status_text(self.config, reading.value_mgdl, stale)
        urgent = status.startswith("URGENT")

        lines = [
            f"{glucose_text} {trend}",
            f"d{delta_text}  {age_minutes}m",
            status,
        ]
        self._draw_lines(bb, lines)
        return RenderState(urgent=urgent, status=status)

    def _draw_lines(self, bb: BusyBar, lines: list[str]) -> None:
        elements = []
        y = 0
        for idx, text in enumerate(lines):
            elements.append(
                {
                    "id": f"line-{idx}",
                    "type": "text",
                    "x": 0,
                    "y": y,
                    "text": text,
                    "font": "small",
                    "display": "front",
                }
            )
            y += 16

        payload = {
            "application_name": self.config.application_name,
            "elements": elements,
        }

        prepared = bb.prepare_request("POST", "/api/display/draw", json_payload=payload)
        bb.execute_prepared_request(prepared)

    def play_alert(self, bb: BusyBar) -> None:
        if not self.config.alert_sound_path:
            return
        bb.audio_play(
            application_name=self.config.application_name,
            path=self.config.alert_sound_path,
        )


def _status_text(config: AppConfig, value: int, stale: bool) -> str:
    if stale:
        return "URGENT STALE"
    if value <= config.urgent_low_threshold:
        return "URGENT LOW"
    if value >= config.urgent_high_threshold:
        return "URGENT HIGH"
    if value < config.low_threshold:
        return "LOW"
    if value > config.high_threshold:
        return "HIGH"
    return "IN RANGE"


def _trend_to_symbol(trend: str | None) -> str:
    if not trend:
        return "-"

    key = trend.strip().lower()
    mapping = {
        "doubleup": "^^",
        "singleup": "^",
        "fortyfiveup": "/",
        "flat": "->",
        "fortyfivedown": "\\",
        "singledown": "v",
        "doubledown": "vv",
        "notcomputable": "?",
        "rateoutofrange": "!",
        "up": "^",
        "down": "v",
    }
    return mapping.get(key, trend)


def _format_glucose(value_mgdl: int, display_mode: str) -> str:
    if display_mode == "mmol":
        return f"{_mgdl_to_mmol(value_mgdl):.1f} mmol/L"
    if display_mode == "both":
        return f"{value_mgdl} mg/dL {_mgdl_to_mmol(value_mgdl):.1f}"
    return f"{value_mgdl} mg/dL"


def _mgdl_to_mmol(value_mgdl: int) -> float:
    return value_mgdl / 18.0
