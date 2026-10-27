import { column, generateXpm2, row, type Node } from "@busy-app/busy-lib";
import type { Config } from "./config";
import type { Reading, Trend } from "./dexcom";

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

/** The glucose screen: big value, trend arrow, then delta over age. */
export function readingFrame(latest: Reading, deltaMgdl: number | null, cfg: Config, now: number): Node {
  const minutes = Math.max(0, Math.floor((now - latest.time) / 60000));
  if (minutes >= EXPIRED_MINUTES) {
    return row({ width: 72, height: 16, justify: "center", align: "center", gap: 4 }, [
      { type: "text", id: "value", text: "---", font: "extra_large", color: STALE },
      { type: "text", id: "age", text: ">1h", font: "small", color: WARN },
    ]);
  }

  const stale = minutes >= cfg.staleMinutes;
  const color = stale ? STALE : rangeColor(rangeOf(latest.mgdl, cfg), cfg);
  const children: Node[] = [{ type: "text", id: "value", text: formatValue(latest.mgdl, cfg), font: "extra_large", color }];

  const arrow = stale ? null : ARROWS[latest.trend];
  if (arrow) {
    children.push({
      type: "xpmbitmap",
      id: "arrow",
      data: generateXpm2({ palette: { "#": color, ".": "none" }, grid: arrow }),
      width: arrow[0].length,
      height: arrow.length,
    });
  }

  children.push(
    column({ gap: 2, align: "end" }, [
      { type: "text", id: "delta", text: formatDelta(stale ? null : deltaMgdl, cfg), font: "small", color: SUBTLE },
      { type: "text", id: "age", text: `${minutes}m`, font: "small", color: stale ? WARN : SUBTLE },
    ]),
  );

  return row({ width: 72, height: 16, justify: "center", align: "center", gap: 3 }, children);
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
