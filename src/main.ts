import { device } from "@shared/device";
import { render, type Node } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { loadConfig, type Config } from "./config";
import { DexcomShare } from "./dexcom";
import { messageFrame, rangeColor, rangeOf, readingFrame, type Extras } from "./display";
import { FRAME_MS, STILL, tweenAt, tweenFor, type Fx, type Tween } from "./motion";
import { Nightscout } from "./nightscout";
import { AuthError, type Reading } from "./reading";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

/** Dexcom sensors report every 5 minutes; Share lags a little behind. */
const READING_INTERVAL_MS = 5 * 60 * 1000;
const SHARE_LAG_MS = 20 * 1000;
/** Nightscout has no login to protect and may carry 1-minute data: check every minute while it supplies glucose. */
const NIGHTSCOUT_POLL_MS = 60 * 1000;
/** When the expected reading hasn't shown up yet. */
const RETRY_MS = 30 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** Wrong credentials: retry rarely, Dexcom locks accounts after repeated failures. */
const AUTH_RETRY_MS = 10 * 60 * 1000;
/** The progress line gains a pixel every 5 seconds. */
const TICK_MS = 5 * 1000;

const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

function main(): void {
  let cfg: Config | null = null;
  // Dexcom is the glucose source when set up; Nightscout fills in when it isn't, fails or lags, and always supplies COB/IOB.
  let dexcom: DexcomShare | null = null;
  let dexcomKey = "";
  let nightscout: Nightscout | null = null;
  let nightscoutKey = "";
  /** After Dexcom rejects the login, it is left alone until then so the account doesn't get locked. */
  let dexcomPausedUntil = 0;
  let dexcomPauseMessage = "";
  let latest: Reading | null = null;
  let deltaMgdl: number | null = null;
  let extras: Extras | null = null;
  let message = "Loading...";
  let failures = 0;
  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Time of the reading the LED last blinked for, so it blinks once per urgent reading. */
  let blinkedFor = 0;

  // Elements on screen, by id, as last sent: only changes are redrawn.
  let shown = new Map<string, string>();
  let drawing = false;
  let redrawPending = false;

  // The value counting to a new reading. The arrow's glide is an animation the bar plays by itself.
  let animTimer: ReturnType<typeof setInterval> | null = null;
  let tween: Tween | null = null;
  let fx: Fx = STILL;

  function frame(): Node {
    if (latest && cfg) return readingFrame(latest, deltaMgdl, extras, cfg, Date.now(), fx);
    return messageFrame(message);
  }

  async function draw(): Promise<void> {
    if (drawing) {
      redrawPending = true;
      return;
    }
    drawing = true;
    try {
      const elements = render(frame());
      const next = new Map<string, string>();
      const changed = [];
      for (const el of elements) {
        const json = JSON.stringify(el);
        next.set(el.id, json);
        if (shown.get(el.id) !== json) changed.push(el);
      }
      const removed = [...shown.keys()].filter((id) => !next.has(id));

      let led: string | undefined;
      if (latest && cfg?.blinkUrgent && latest.time !== blinkedFor) {
        const range = rangeOf(latest.mgdl, cfg);
        if (range === "urgent_low" || range === "urgent_high") {
          led = rangeColor(range, cfg);
          blinkedFor = latest.time;
        }
      }

      if (removed.length) await device.DisplayClear({ application_name: APP, element_ids: removed });
      if (changed.length || led) {
        await device.DisplayDraw({
          application_name: APP,
          priority: 50,
          elements: changed,
          ...(led ? { led_notification_color: led } : {}),
        });
      }
      shown = next;
      animate();
    } catch (err) {
      // Resend everything next time; the screen state is unknown.
      shown = new Map();
      throw err;
    } finally {
      drawing = false;
      if (redrawPending && !stopped) {
        redrawPending = false;
        void draw().catch(report);
      }
    }
  }

  /** The animation frame at this moment. */
  function currentFx(): Fx {
    const counting = tween ? tweenAt(tween, Date.now()) : null;
    if (!counting) tween = null;
    return { mgdl: counting?.mgdl ?? null, flash: counting?.flash ?? 0 };
  }

  /** Runs the animation timer only while the value is counting. */
  function animate(): void {
    const wanted = !stopped && tween !== null;
    if (wanted && !animTimer) {
      animTimer = setInterval(() => {
        const next = currentFx();
        // Only redraw when the shown value or its flash changes.
        const changed =
          next.flash !== fx.flash ||
          (next.mgdl === null) !== (fx.mgdl === null) ||
          (next.mgdl !== null && fx.mgdl !== null && Math.round(next.mgdl) !== Math.round(fx.mgdl));
        fx = next;
        if (changed) void draw().catch(report);
        if (!tween) animate();
      }, FRAME_MS);
    } else if (!wanted && animTimer) {
      clearInterval(animTimer);
      animTimer = null;
      fx = STILL;
    }
  }

  function schedule(ms: number): void {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, ms);
  }

  async function poll(): Promise<void> {
    if (polling || stopped) return;
    polling = true;
    let next = RETRY_MS;
    // Source failures are reported where they happen.
    let dexcomError: unknown = null;
    let nightscoutError: unknown = null;
    try {
      cfg = await loadConfig(APP);
      const hasDexcom = !!cfg.username && !!cfg.password;
      const hasNightscout = !!cfg.nsUrl;
      if (!hasDexcom && !hasNightscout) {
        // Settings are local: check again soon (RETRY_MS) so new credentials show up quickly.
        throw new AuthError("Set Dexcom/NS");
      }

      const dKey = hasDexcom ? `${cfg.region}\n${cfg.username}\n${cfg.password}` : "";
      const nKey = hasNightscout ? `${cfg.nsUrl}\n${cfg.nsToken}` : "";
      if (dKey !== dexcomKey || nKey !== nightscoutKey) {
        if (dKey !== dexcomKey) {
          dexcom = hasDexcom ? new DexcomShare(cfg.username, cfg.password, cfg.region) : null;
          dexcomPausedUntil = 0;
        }
        nightscout = hasNightscout ? new Nightscout(cfg.nsUrl, cfg.nsToken) : null;
        dexcomKey = dKey;
        nightscoutKey = nKey;
        latest = null;
        extras = null;
        message = "Connecting...";
        void draw().catch(report);
      }

      const now = Date.now();
      let readings: Reading[] | null = null;
      let fromNightscout = false;
      if (dexcom && now >= dexcomPausedUntil) {
        try {
          readings = await dexcom.readings(2);
        } catch (err) {
          report(err);
          dexcomError = err;
          if (err instanceof AuthError) {
            dexcomPausedUntil = now + AUTH_RETRY_MS;
            dexcomPauseMessage = err.message;
          }
        }
      } else if (dexcom) {
        dexcomError = new AuthError(dexcomPauseMessage);
      }

      // Nightscout fills in when Dexcom gave nothing current.
      const dexcomCurrent = !!readings && readings.length > 0 && now - readings[0].time < cfg.staleMinutes * 60 * 1000;
      if (nightscout && !dexcomCurrent) {
        try {
          const fallback = await nightscout.readings(2);
          if (fallback.length > 0 && (!readings || readings.length === 0 || fallback[0].time > readings[0].time)) {
            readings = fallback;
            fromNightscout = true;
          } else if (!readings) {
            readings = fallback;
          }
        } catch (err) {
          report(err);
          nightscoutError = err;
        }
      }

      if (nightscout && (cfg.displayMode === "iob" || cfg.displayMode === "iob_cob")) {
        // Shown as "--" when unavailable; never holds up the reading.
        extras = await nightscout.extras().catch((err) => {
          report(err);
          return null;
        });
      }

      if (!readings) throw dexcomError ?? nightscoutError ?? new Error("No glucose source answered");
      failures = 0;
      if (readings.length === 0) {
        latest = null;
        message = "No data";
      } else {
        const [newest, previous] = readings;
        // A new reading counts up or down from what is on screen.
        if (latest && newest.time !== latest.time && cfg.displayMode !== "arrow") {
          tween = tweenFor(fx.mgdl ?? latest.mgdl, newest.mgdl, Date.now());
        }
        latest = newest;
        // Start from the old value, not a flash of the new one.
        if (tween) fx = currentFx();
        // A delta across a gap in the data would mislead.
        deltaMgdl = previous && newest.time - previous.time < 11 * 60 * 1000 ? newest.mgdl - previous.mgdl : null;
        // Ask again right after the next reading should land.
        const maxWait = fromNightscout ? NIGHTSCOUT_POLL_MS : READING_INTERVAL_MS + SHARE_LAG_MS;
        const due = newest.time + READING_INTERVAL_MS + SHARE_LAG_MS - Date.now();
        next = due > 0 ? Math.min(due, maxWait) : RETRY_MS;
      }
    } catch (err) {
      if (err instanceof AuthError) {
        latest = null;
        message = err.message;
        next = err.message === "Set Dexcom/NS" ? RETRY_MS : AUTH_RETRY_MS;
      } else {
        if (err !== dexcomError && err !== nightscoutError) report(err);
        failures += 1;
        next = Math.min(RETRY_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
        // Keep showing the last reading (it greys out as it ages); otherwise say why.
        if (!latest) message = "No connection";
      }
    } finally {
      polling = false;
    }
    if (stopped) return;
    void draw().catch(report);
    schedule(next);
  }

  void draw().catch(report);
  void poll();

  // Advances the progress line; the rest only changes when a reading comes in.
  const ticker = setInterval(() => {
    if (latest) void draw().catch(report);
  }, TICK_MS);

  // OK refreshes now. Back leaves the app.
  const unbind = listen("input", (event) => {
    if (stopped || event.action !== "short") return;
    if (event.key === "ok") {
      if (!polling) schedule(0);
      return;
    }
    if (event.key !== "back") return;

    stopped = true;
    clearInterval(ticker);
    if (animTimer) clearInterval(animTimer);
    if (pollTimer) clearTimeout(pollTimer);

    // Not detached from inside the handler itself: with nothing else left the unbind stops the app on the spot, while this handler is still running.
    setTimeout(unbind, 0);
  });
}

main();
