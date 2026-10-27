// The glucose value counting to a new reading. The arrow's glide is a native animation (tools/make_arrow_anims.py).

/** Animation frames are this far apart. */
export const FRAME_MS = 110;

/** What the animations change on the current frame. */
export interface Fx {
  /** The value shown while counting toward a new reading; null shows the reading itself. */
  mgdl: number | null;
  /** 0–1: how far the value's color is washed toward white. */
  flash: number;
}

export const STILL: Fx = { mgdl: null, flash: 0 };

export interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  /** Big jumps start with a flash. */
  flash: boolean;
}

/** How the value moves to a new reading: the bigger the jump, the longer the count. Null for no animation. */
export function tweenFor(from: number, to: number, now: number): Tween | null {
  const jump = Math.abs(to - from);
  if (jump < 3) return null;
  // The bar lays out about 3 frames a second, so these give roughly 3, 5 and 7 visible steps.
  if (jump < 10) return { from, to, start: now, duration: 900, flash: false };
  if (jump < 20) return { from, to, start: now, duration: 1500, flash: false };
  return { from, to, start: now, duration: 2200, flash: true };
}

/** The tween's value and flash at `now`, or null once it has finished. */
export function tweenAt(tween: Tween, now: number): { mgdl: number; flash: number } | null {
  const t = (now - tween.start) / tween.duration;
  if (t >= 1) return null;
  // Ease in and out, so the steps spread across the count instead of bunching at the start.
  const u = Math.max(0, t);
  const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  return {
    mgdl: tween.from + (tween.to - tween.from) * eased,
    flash: tween.flash ? Math.max(0, 1 - t * 2) : 0,
  };
}

/** Mixes two #RRGGBBAA colors; t = 0 gives `a`, 1 gives `b`. */
export function mixColor(a: string, b: string, t: number): string {
  let out = "#";
  for (let i = 1; i < 9; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    const v = Math.round(x + (y - x) * t);
    out += (v < 16 ? "0" : "") + v.toString(16).toUpperCase();
  }
  return out;
}
