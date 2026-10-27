// What every glucose source returns.

export type Trend =
  | "none"
  | "double_up"
  | "single_up"
  | "forty_five_up"
  | "flat"
  | "forty_five_down"
  | "single_down"
  | "double_down"
  | "not_computable"
  | "rate_out_of_range";

export interface Reading {
  /** mg/dL. Dexcom reports 39 for "below 40" and 401 for "above 400". */
  mgdl: number;
  trend: Trend;
  /** Sensor time, ms since epoch. */
  time: number;
}

export interface Source {
  /** The newest readings, newest first; at most `count`. */
  readings(count: number): Promise<Reading[]>;
}

/** A failure the user has to fix (wrong password, bad URL); retrying soon won't help. */
export class AuthError extends Error {}

// Dexcom's trend names, in the order of its older numeric codes. Nightscout uses the same names.
const TRENDS: [string, Trend][] = [
  ["None", "none"],
  ["DoubleUp", "double_up"],
  ["SingleUp", "single_up"],
  ["FortyFiveUp", "forty_five_up"],
  ["Flat", "flat"],
  ["FortyFiveDown", "forty_five_down"],
  ["SingleDown", "single_down"],
  ["DoubleDown", "double_down"],
  ["NotComputable", "not_computable"],
  ["RateOutOfRange", "rate_out_of_range"],
];

/** Trend from a Dexcom/Nightscout name ("FortyFiveUp", "NOT COMPUTABLE") or a Dexcom numeric code. */
export function parseTrend(value: unknown): Trend {
  if (typeof value === "number") return TRENDS[value]?.[1] ?? "none";
  if (typeof value !== "string") return "none";
  const key = value.replace(/[\s_]/g, "").toLowerCase();
  // Some uploaders send TripleUp/TripleDown; show them as double.
  if (key === "tripleup") return "double_up";
  if (key === "tripledown") return "double_down";
  for (const [name, trend] of TRENDS) {
    if (name.toLowerCase() === key) return trend;
  }
  return "none";
}
