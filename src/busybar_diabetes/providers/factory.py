from __future__ import annotations

from busybar_diabetes.config import AppConfig

from .base import GlucoseProvider
from .dexcom import DexcomShareProvider
from .nightscout import NightscoutProvider


def build_provider(config: AppConfig) -> GlucoseProvider:
    if config.provider == "nightscout":
        assert config.ns_base_url is not None
        return NightscoutProvider(base_url=config.ns_base_url, token=config.ns_token)

    assert config.dexcom_username is not None
    assert config.dexcom_password is not None
    return DexcomShareProvider(
        username=config.dexcom_username,
        password=config.dexcom_password,
        ous=config.dexcom_ous,
    )
