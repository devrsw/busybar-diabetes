import { column, generateXpm2, row, textWidth, type DeviceFont, type Node } from "@busy-app/busy-lib";
import type { Config } from "./config";
import { mixColor, STILL, type Fx } from "./motion";
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

/** Insulin and carbs on board from Nightscout; null when unknown. */
export interface Extras {
  iob: number | null;
  cob: number | null;
}

/** The glucose screen in the configured display mode, over a line counting down to the next reading. `fx` is the current frame of the value's count. */
export function readingFrame(
  latest: Reading,
  deltaMgdl: number | null,
  extras: Extras | null,
  cfg: Config,
  now: number,
  fx: Fx = STILL,
): Node {
  const age = Math.max(0, now - latest.time);
  const minutes = Math.floor(age / 60000);
  if (minutes >= EXPIRED_MINUTES) {
    return row({ width: 72, height: 16, justify: "center", align: "center", gap: 4 }, [
      { type: "text", id: "value", text: "---", font: "extra_large", color: STALE },
      { type: "text", id: "delta", text: ">1h", font: "large", color: WARN },
    ]);
  }

  const stale = minutes >= cfg.staleMinutes;
  // While counting toward a new reading, the color follows the count through the ranges.
  const mgdl = stale || fx.mgdl === null ? latest.mgdl : fx.mgdl;
  const color = stale ? STALE : mixColor(rangeColor(rangeOf(mgdl, cfg), cfg), "#FFFFFFFF", fx.flash * 0.8);
  const value = formatValue(mgdl, cfg);
  const valueNode: Node = { type: "text", id: "value", text: value, font: "extra_large", color };
  const small = stale ? null : ARROWS[latest.trend];

  let mode = cfg.displayMode;
  // IOB/COB only come from Nightscout; a missing arrow leaves the arrow mode nothing to show.
  if ((mode === "iob" || mode === "iob_cob") && !cfg.nsUrl) mode = "delta";
  const big = stale ? null : BIG_ARROWS[latest.trend];
  if (mode === "arrow" && !big) mode = "number";

  const children: Node[] = [];
  if (mode === "arrow") {
    children.push(arrowNode(big!, color, latest.trend, "big", cfg.animateArrow));
  } else if (mode === "number") {
    children.push(valueNode);
  } else if (mode === "iob_cob") {
    children.push(valueNode);
    const lines = column({ gap: 2, align: "end" }, [
      { type: "text", id: "cob", text: formatCob(extras?.cob ?? null), font: "small", color: SUBTLE },
      { type: "text", id: "iob", text: formatIob(extras?.iob ?? null), font: "small", color: SUBTLE },
    ]);
    const linesWidth = Math.max(textWidth(formatCob(extras?.cob ?? null), "small"), textWidth(formatIob(extras?.iob ?? null), "small"));
    // The arrow goes first when space runs short.
    if (small && textWidth(value, "extra_large") + small[0].length + linesWidth + 2 * GAP <= 72) {
      children.push(arrowNode(small, color, latest.trend, "small", cfg.animateArrow));
    }
    children.push(lines);
  } else {
    children.push(valueNode);
    let used = textWidth(value, "extra_large");
    if (small) {
      children.push(arrowNode(small, color, latest.trend, "small", cfg.animateArrow));
      used += GAP + small[0].length;
    }
    // Once stale, the age takes this spot: the progress line no longer says how old the reading is.
    const side = stale ? `${minutes}m` : mode === "iob" ? formatIob(extras?.iob ?? null) : formatDelta(deltaMgdl, cfg);
    let font = DELTA_FONTS[DELTA_FONTS.length - 1].font;
    for (const candidate of DELTA_FONTS) {
      if (used + GAP + textWidth(side, candidate.font) <= 72) {
        font = candidate.font;
        break;
      }
    }
    children.push({ type: "text", id: "delta", text: side, font, color: stale ? WARN : SUBTLE });
  }

  return column({ width: 72, height: 16, gap: 1 }, [
    row({ width: 72, height: 14, justify: "center", align: "center", gap: GAP }, children),
    progressLine(Math.min(1, age / READING_MS)),
  ]);
}

/** Colors the arrow animations are rendered in: the color options in settings.json. */
const ANIM_COLORS = ["FF0000", "FF3000", "FF6000", "FFC000", "FFFF00", "00FF30", "00FFC0", "00C0FF", "0060FF", "A040FF", "FF40C0", "FFFFFF"];
/** The animations' canvas extends this far past the arrow along its direction, so it can glide. */
const ANIM_PAD = 3;

/** The arrow: a glide animation played by the bar (tools/make_arrow_anims.py), or a still bitmap. */
function arrowNode(grid: string[], color: string, trend: Trend, size: "small" | "big", animate: boolean): Node {
  const hex = color.slice(1, 7).toUpperCase();
  const direction = NUDGE[trend];
  // Colors mid-flash have no animation; they show the still arrow until the flash ends.
  if (animate && direction && ANIM_COLORS.indexOf(hex) >= 0) {
    return {
      type: "animation",
      id: "arrow_anim",
      path: `animations/arrow-${size}-${trend}-${hex}.anim`,
      loop: true,
      // Laid out at the arrow's size; the padded canvas is shifted back over it.
      width: grid[0].length,
      height: grid.length,
      dx: direction[0] ? -ANIM_PAD : 0,
      dy: direction[1] ? -ANIM_PAD : 0,
    };
  }
  return {
    type: "xpmbitmap",
    id: "arrow",
    data: generateXpm2({ palette: { "#": color.slice(0, 7), ".": "none" }, grid }),
    width: grid[0].length,
    height: grid.length,
  };
}

/** Five one-minute segments along the bottom row, inset from the edges, filling one pixel every 6 seconds. */
function progressLine(fraction: number): Node {
  const segment = 10;
  const gap = 3;
  const margin = (72 - (5 * segment + 4 * gap)) / 2;
  const filled = Math.round(fraction * segment * 5);
  let line = "";
  for (let x = 0; x < 72; x++) {
    const pos = x - margin;
    const offset = pos % (segment + gap);
    if (pos < 0 || pos >= 5 * segment + 4 * gap || offset >= segment) line += ".";
    else line += Math.floor(pos / (segment + gap)) * segment + offset < filled ? "#" : "-";
  }
  return {
    type: "xpmbitmap",
    id: "progress",
    data: generateXpm2({ palette: { "#": "#999999", "-": "#262626", ".": "none" }, grid: [line] }),
    width: 72,
    height: 1,
  };
}

function formatIob(iob: number | null): string {
  return iob === null ? "--U" : `${iob.toFixed(1)}U`;
}

function formatCob(cob: number | null): string {
  return cob === null ? "--g" : `${Math.round(cob)}g`;
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

/** An up arrow: a triangular head as tall as half the width, over a centered shaft. */
function upArrow(width: number, height: number, shaft: number): string[] {
  const mid = (width - 1) / 2;
  const grid: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const reach = y < width / 2 ? y + 0.5 : shaft / 2 - 0.5;
      line += Math.abs(x - mid) <= reach ? "#" : ".";
    }
    grid.push(line);
  }
  return grid;
}

/** An up-right arrow: head along the top and right edges, `thickness` pixels thick, with a diagonal shaft. */
function upRightArrow(size: number, thickness: number): string[] {
  const grid: string[] = [];
  for (let y = 0; y < size; y++) {
    let line = "";
    for (let x = 0; x < size; x++) {
      const head = (y < thickness && x >= thickness) || (x >= size - thickness && y <= size - 3);
      const shaft = x + y >= size - 1 && x + y <= size + thickness - 2;
      line += head || shaft ? "#" : ".";
    }
    grid.push(line);
  }
  return grid;
}

const flipV = (g: string[]) => g.slice().reverse();
const flipH = (g: string[]) => g.map((line) => line.split("").reverse().join(""));
const transpose = (g: string[]) => g[0].split("").map((_, x) => g.map((line) => line[x]).join(""));
const double = (g: string[]) => g.map((line) => `${line}.${line}`);

function arrowSet(up: string[], upRight: string[]): Record<Trend, string[] | null> {
  const down = flipV(up);
  return {
    none: null,
    not_computable: null,
    rate_out_of_range: null,
    double_up: double(up),
    single_up: up,
    forty_five_up: upRight,
    flat: flipH(transpose(up)),
    forty_five_down: flipV(upRight),
    single_down: down,
    double_down: double(down),
  };
}

/** Beside the value. */
const ARROWS = arrowSet(upArrow(8, 10, 2), upRightArrow(9, 2));
/** Alone on screen in the arrow display mode. */
const BIG_ARROWS = arrowSet(upArrow(12, 12, 4), upRightArrow(12, 3));

/** The direction the arrow glides when animated: also which way the animations' canvas is padded. */
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
