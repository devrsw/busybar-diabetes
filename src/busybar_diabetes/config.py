from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class AppConfig:
    busybar_ip: str
    provider: str
    poll_seconds: int
    unit: str
    display_mode: str
    low_threshold: int
    high_threshold: int
    urgent_low_threshold: int
    urgent_high_threshold: int
    stale_minutes: int
    alert_sound_path: str | None
    alert_cooldown_seconds: int
    application_name: str

    ns_base_url: str | None
    ns_token: str | None

    dexcom_username: str | None
    dexcom_password: str | None
    dexcom_ous: bool

    @classmethod
    def from_env(cls) -> "AppConfig":
        cfg = cls(
            busybar_ip=os.getenv("BUSYBAR_IP", "").strip(),
            provider=os.getenv("BB_PROVIDER", "nightscout").strip().lower(),
            poll_seconds=_env_int("BB_POLL_SECONDS", 15),
            unit=os.getenv("BB_UNIT", "mg/dL").strip(),
            display_mode=os.getenv("BB_DISPLAY_MODE", "").strip().lower(),
            low_threshold=_env_int("BB_LOW_THRESHOLD", 70),
            high_threshold=_env_int("BB_HIGH_THRESHOLD", 180),
            urgent_low_threshold=_env_int("BB_URGENT_LOW_THRESHOLD", 55),
            urgent_high_threshold=_env_int("BB_URGENT_HIGH_THRESHOLD", 250),
            stale_minutes=_env_int("BB_STALE_MINUTES", 10),
            alert_sound_path=os.getenv("BB_ALERT_SOUND_PATH") or None,
            alert_cooldown_seconds=_env_int("BB_ALERT_COOLDOWN_SECONDS", 300),
            application_name=os.getenv("BB_APPLICATION_NAME", "busybar-diabetes"),
            ns_base_url=os.getenv("NS_BASE_URL") or None,
            ns_token=os.getenv("NS_TOKEN") or None,
            dexcom_username=os.getenv("DEXCOM_USERNAME") or None,
            dexcom_password=os.getenv("DEXCOM_PASSWORD") or None,
            dexcom_ous=_env_bool("DEXCOM_OUS", True),
        )
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if not self.busybar_ip:
            raise ValueError("BUSYBAR_IP is required")
        if self.provider not in {"nightscout", "dexcom"}:
            raise ValueError("BB_PROVIDER must be 'nightscout' or 'dexcom'")
        if self.poll_seconds < 5:
            raise ValueError("BB_POLL_SECONDS must be >= 5")

        # Backward compatibility: if mode is unset, infer from BB_UNIT.
        if not self.display_mode:
            unit_key = self.unit.strip().lower()
            if unit_key in {"mmol", "mmol/l"}:
                self.display_mode = "mmol"
            elif unit_key in {"both", "dual"}:
                self.display_mode = "both"
            else:
                self.display_mode = "mgdl"

        if self.display_mode not in {"mgdl", "mmol", "both"}:
            raise ValueError("BB_DISPLAY_MODE must be 'mgdl', 'mmol', or 'both'")

        if self.provider == "nightscout" and not self.ns_base_url:
            raise ValueError("NS_BASE_URL is required for nightscout provider")

        if self.provider == "dexcom":
            if not self.dexcom_username or not self.dexcom_password:
                raise ValueError(
                    "DEXCOM_USERNAME and DEXCOM_PASSWORD are required for dexcom provider"
                )
