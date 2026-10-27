import { device } from "@shared/device";
import { loadValues, type SettingsValues } from "@shared/settings";
import type { Region } from "./dexcom";

export interface Config {
  source: "dexcom" | "nightscout";
  username: string;
  password: string;
  region: Region;
  nsUrl: string;
  nsToken: string;
  units: "mgdl" | "mmol";
  staleMinutes: number;
  animateArrow: boolean;
  urgentLow: number;
  low: number;
  high: number;
  urgentHigh: number;
  blinkUrgent: boolean;
  colors: {
    urgentLow: string;
    low: string;
    inRange: string;
    high: string;
    urgentHigh: string;
  };
}

/** Reads the settings, filling anything missing with the defaults in settings.json. */
export async function loadConfig(appId: string): Promise<Config> {
  let values = await loadValues();
  if (!values) {
    try {
      values = (await device.AppsSettingsGet({ app_id: appId })).values;
    } catch {
      values = {};
    }
  }
  const get = (group: string, key: string): unknown => {
    // Groups come as nested objects; accept flat ids too.
    if (!group) return values?.[key];
    const nested = values?.[group] as SettingsValues | undefined;
    return nested && typeof nested === "object" ? nested[key] : values?.[key];
  };
  const str = (group: string, key: string, fallback: string) => {
    const v = get(group, key);
    return typeof v === "string" ? v : fallback;
  };
  const num = (group: string, key: string, fallback: number) => {
    const v = get(group, key);
    return typeof v === "number" && isFinite(v) ? v : fallback;
  };
  const color = (key: string, fallback: string) => toRgba(str("colors", key, fallback));

  const region = str("dexcom", "region", "us");
  return {
    source: str("", "source", "dexcom") === "nightscout" ? "nightscout" : "dexcom",
    username: str("dexcom", "username", "").trim(),
    password: str("dexcom", "password", ""),
    region: region === "ous" || region === "jp" ? region : "us",
    nsUrl: str("nightscout", "url", "").trim(),
    nsToken: str("nightscout", "token", "").trim(),
    units: str("display", "units", "mgdl") === "mmol" ? "mmol" : "mgdl",
    staleMinutes: num("display", "stale_minutes", 15),
    animateArrow: get("display", "animate_arrow") !== false,
    urgentLow: num("ranges", "urgent_low", 55),
    low: num("ranges", "low", 70),
    high: num("ranges", "high", 180),
    urgentHigh: num("ranges", "urgent_high", 250),
    blinkUrgent: get("ranges", "blink_urgent") !== false,
    colors: {
      urgentLow: color("urgent_low", "#FF0000"),
      low: color("low", "#FF6000"),
      inRange: color("in_range", "#00FF30"),
      high: color("high", "#FFC000"),
      urgentHigh: color("urgent_high", "#FF3000"),
    },
  };
}

/** Settings colors may omit alpha; the display wants #RRGGBBAA. */
function toRgba(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}FF` : hex;
}
