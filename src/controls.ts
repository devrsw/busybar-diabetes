// What the knob changes: the display mode and the units. Apps can read their settings but not write them,
// so knob choices are kept in localStorage, each with the setting it overrode. Once that setting is changed
// in the bar's settings, the knob choice is dropped for good: the new setting wins, and changing the setting
// back later doesn't revive the old knob choice.

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

const KEYS = { displayMode: "knob2.view", units: "knob2.units" } as const;
/** Choices saved before 1.7.2, which could stay stuck over the settings: dropped once on upgrade. */
const OLD_KEYS = ["knob.view", "knob.units"];
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

/** The knob's choice for `key` if the setting is still what it overrode; otherwise it is forgotten. */
function current(key: Key, setting: string, valid: string[]): string | null {
  const stored = read(key);
  if (!stored) return null;
  if (stored.base !== setting || valid.indexOf(stored.value) < 0) {
    forget(key);
    return null;
  }
  return stored.value;
}

function forget(key: Key): void {
  try {
    localStorage.removeItem(KEYS[key]);
  } catch {
    // Nothing stored to remove.
  }
}

/** Applies the knob's choices to freshly loaded settings, unless the setting has changed since. */
export function applyKnob(cfg: Config): Config {
  try {
    for (const key of OLD_KEYS) if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
  const view = current("displayMode", cfg.displayMode, VIEWS.map((v) => v.view));
  const units = current("units", cfg.units, ["mgdl", "mmol"]);
  return {
    ...cfg,
    displayMode: (view as View | null) ?? cfg.displayMode,
    units: (units as Config["units"] | null) ?? cfg.units,
  };
}

/** Remembers a knob choice against the setting it overrides. Every write rewrites flash: call it once things settle. */
export function rememberKnob(key: Key, value: string, setting: string): void {
  if (value === setting) return forget(key);
  try {
    localStorage.setItem(KEYS[key], JSON.stringify({ value, base: setting }));
  } catch {
    // Not remembered: the knob still works until the app quits.
  }
}
