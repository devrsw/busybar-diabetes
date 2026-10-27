import { column, generateXpm2, row, textWidth, type DeviceFont, type Node } from "@busy-app/busy-lib";
import type { Config } from "./config";
import type { Reading, Trend } from "./reading";

const SUBTLE = "#FFFFFF99";
const STALE = "#707070FF";
const WARN = "#FF4040FF";

/** Readings older than this are not shown at all. */
const EXPIRED_MINUTES = 60;

export type Range = "urgent_low" | "low" | "in_range" | "high" | "urgent_high";

export function rangeOf(mgdl: number, cfg: Config): Range {
  if (mgdl <= cfg.urgentLow) return "urgent_low";
  if (mgdl < cfg.low) return "low";
  if (mgdl >= cfg.urgentHigh) return "urgent_high";
  if (mgdl > cfg.high) return "high";
  return "in_range";
}

export function rangeColor(range: Range, cfg: Config): string {
  const c = cfg.colors;
  switch (range) {
    case "urgent_low":
      return c.urgentLow;
    case "low":
      return c.low;
    case "high":
      return c.high;
    case "urgent_high":
      return c.urgentHigh;
    default:
      return c.inRange;
  }
}

/** Dexcom sensors send a reading every 5 minutes; the progress line spans that. */
const READING_MS = 5 * 60 * 1000;

/** Delta fonts, largest first: the delta matches the value's size when it fits. */
const DELTA_FONTS: { font: DeviceFont }[] = [{ font: "extra_large" }, { font: "large" }, { font: "normal" }, { font: "small" }];

const GAP = 3;

/** The glucose screen: value, trend arrow and delta, over a line counting down to the next reading. */
export function readingFrame(latest: Reading, deltaMgdl: number | null, cfg: Config, now: number): Node {
  const age = Math.max(0, now - latest.time);
  const minutes = Math.floor(age / 60000);
  if (minutes >= EXPIRED_MINUTES) {
    return row({ width: 72, height: 16, justify: "center", align: "center", gap: 4 }, [
      { type: "text", id: "value", text: "---", font: "extra_large", color: STALE },
      { type: "text", id: "delta", text: ">1h", font: "large", color: WARN },
    ]);
  }

  const stale = minutes >= cfg.staleMinutes;
  const color = stale ? STALE : rangeColor(rangeOf(latest.mgdl, cfg), cfg);
  const value = formatValue(latest.mgdl, cfg);
  const children: Node[] = [{ type: "text", id: "value", text: value, font: "extra_large", color }];
  let used = textWidth(value, "extra_large");

  const arrow = stale ? null : ARROWS[latest.trend];
  if (arrow) {
    children.push({
      type: "xpmbitmap",
      id: "arrow",
      data: generateXpm2({ palette: { "#": color, ".": "none" }, grid: arrow }),
      width: arrow[0].length,
      height: arrow.length,
    });
    used += GAP + arrow[0].length;
  }

  // Once stale, the age replaces the delta: the progress line no longer says how old the reading is.
  const side = stale ? `${minutes}m` : formatDelta(deltaMgdl, cfg);
  let font = DELTA_FONTS[DELTA_FONTS.length - 1].font;
  for (const candidate of DELTA_FONTS) {
    if (used + GAP + textWidth(side, candidate.font) <= 72) {
      font = candidate.font;
      break;
    }
  }
  children.push({ type: "text", id: "delta", text: side, font, color: stale ? WARN : SUBTLE });

  return column({ width: 72, height: 16, gap: 1 }, [
    row({ width: 72, height: 14, justify: "center", align: "center", gap: GAP }, children),
    progressLine(Math.min(1, age / READING_MS)),
  ]);
}

/** Five one-minute segments along the bottom row, filling one pixel every 5 seconds. */
function progressLine(fraction: number): Node {
  const segment = 12;
  const filled = Math.round(fraction * segment * 5);
  let line = "";
  for (let x = 0; x < 72; x++) {
    const index = Math.floor(x / (segment + 3));
    const offset = x % (segment + 3);
    if (offset >= segment) line += ".";
    else line += index * segment + offset < filled ? "#" : "-";
  }
  return {
    type: "xpmbitmap",
    id: "progress",
    data: generateXpm2({ palette: { "#": "#999999", "-": "#262626", ".": "none" }, grid: [line] }),
    width: 72,
    height: 1,
  };
}

/** A short status line in place of a reading. */
export function messageFrame(text: string): Node {
  return row({ width: 72, height: 16, justify: "center", align: "center" }, [
    { type: "text", id: "message", text, font: "small", color: SUBTLE },
  ]);
}

function formatValue(mgdl: number, cfg: Config): string {
  // Dexcom reports 39 for "below 40" and 401 for "above 400".
  if (mgdl < 40) return "LO";
  if (mgdl > 400) return "HI";
  return cfg.units === "mmol" ? (mgdl / 18.0182).toFixed(1) : String(Math.round(mgdl));
}

function formatDelta(delta: number | null, cfg: Config): string {
  if (delta === null) return "--";
  const text = cfg.units === "mmol" ? (delta / 18.0182).toFixed(1) : String(Math.round(delta));
  // Rounding can leave "-0"; show it as "+0".
  return Number(text) < 0 ? text : `+${text.replace("-", "")}`;
}

// Arrows are drawn as bitmaps: the fonts are ASCII only.

const UP = [
  "...##...",
  "..####..",
  ".######.",
  "########",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
];

const UP_RIGHT = (() => {
  const grid: string[] = [];
  for (let y = 0; y < 9; y++) {
    let line = "";
    for (let x = 0; x < 9; x++) {
      const head = (y <= 1 && x >= 2) || (x >= 7 && y <= 6);
      const shaft = x + y === 8 || x + y === 9;
      line += head || shaft ? "#" : ".";
    }
    grid.push(line);
  }
  return grid;
})();

const flipV = (g: string[]) => g.slice().reverse();
const flipH = (g: string[]) => g.map((line) => line.split("").reverse().join(""));
const transpose = (g: string[]) => g[0].split("").map((_, x) => g.map((line) => line[x]).join(""));
const double = (g: string[]) => g.map((line) => `${line}.${line}`);

const RIGHT = flipH(transpose(UP));
const DOWN = flipV(UP);

/** The way the arrow nudges when animated: one pixel along its direction. */
export const NUDGE: Record<Trend, [number, number] | null> = {
  none: null,
  not_computable: null,
  rate_out_of_range: null,
  double_up: [0, -1],
  single_up: [0, -1],
  forty_five_up: [1, -1],
  flat: [1, 0],
  forty_five_down: [1, 1],
  single_down: [0, 1],
  double_down: [0, 1],
};

const ARROWS: Record<Trend, string[] | null> = {
  none: null,
  not_computable: null,
  rate_out_of_range: null,
  double_up: double(UP),
  single_up: UP,
  forty_five_up: UP_RIGHT,
  flat: RIGHT,
  forty_five_down: flipV(UP_RIGHT),
  single_down: DOWN,
  double_down: double(DOWN),
};
