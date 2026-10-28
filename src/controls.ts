// What the knob changes: the display mode and the units. Apps can read their settings but not write them,
// so knob choices are kept in localStorage, each with the setting it overrode: when that setting is changed
// in the bar's settings, the new setting wins.

import type { Config } from "./config";

export type View = Config["displayMode"];

/** The views in knob order, with the names shown while switching. */
export const VIEWS: { view: View; label: string }[] = [
  { view: "delta", label: "Number + delta" },
  { view: "number", label: "Number only" },
  { view: "arrow", label: "Arrow only" },
  { view: "iob", label: "Number + IOB" },
  { view: "iob_cob", label: "COB + IOB" },
];

/** The views the knob cycles through: the IOB views need Nightscout. */
export function availableViews(cfg: Config): View[] {
  return VIEWS.map((v) => v.view).filter((v) => cfg.nsUrl || (v !== "iob" && v !== "iob_cob"));
}

export function viewLabel(view: View): string {
  return VIEWS.find((v) => v.view === view)?.label ?? view;
}

interface Stored {
  /** The knob's choice. */
  value: string;
  /** The setting it overrode. */
  base: string;
}

const KEYS = { displayMode: "knob.view", units: "knob.units" } as const;
type Key = keyof typeof KEYS;

function read(key: Key): Stored | null {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    return stored && typeof stored.value === "string" && typeof stored.base === "string" ? stored : null;
  } catch {
    return null;
  }
}

/** Applies the knob's choices to freshly loaded settings, unless the setting has changed since. */
export function applyKnob(cfg: Config): Config {
  const view = read("displayMode");
  const units = read("units");
  const views = VIEWS.map((v) => v.view) as string[];
  return {
    ...cfg,
    displayMode: view && view.base === cfg.displayMode && views.indexOf(view.value) >= 0 ? (view.value as View) : cfg.displayMode,
    units: units && units.base === cfg.units && (units.value === "mgdl" || units.value === "mmol") ? units.value : cfg.units,
  };
}

/** Remembers a knob choice against the setting it overrides. Every write rewrites flash: call it once things settle. */
export function rememberKnob(key: Key, value: string, setting: string): void {
  try {
    if (value === setting) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], JSON.stringify({ value, base: setting }));
  } catch {
    // Not remembered: the knob still works until the app quits.
  }
}
