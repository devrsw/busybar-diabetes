import { device } from "@shared/device";
import { render, type Node } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { loadConfig, type Config } from "./config";
import { DexcomShare } from "./dexcom";
import { applyKnob, availableViews, rememberKnob, viewLabel } from "./controls";
import { chartFrame, CHART_MS, messageFrame, rangeColor, rangeOf, readingFrame, toastFrame, type Extras } from "./display";
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
/** A press held at least this long is a hold. Timed here: the firmware's own "long" needs a longer hold than feels natural. */
const HOLD_MS = 600;
/** How long the knob's overlays stay up. */
const TOAST_MS = 1200;
/** How long the position dots show after switching views. */
const DOTS_MS = 1500;
/** A turn the other way this soon after the last step is contact bounce, not the user. */
const BOUNCE_MS = 150;
/** Knob choices are saved once the knob has been still this long: each save rewrites flash. */
const KNOB_SAVE_MS = 3000;
/** Settings changed on the bar show within this long, without waiting for the next glucose poll. */
const SETTINGS_CHECK_MS = 30 * 1000;
/** The progress line gains a pixel every 5 seconds. */
const TICK_MS = 5 * 1000;

const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

function main(): void {
  let cfg: Config | null = null;
  /** The settings as stored, before the knob's choices: what those choices are remembered against. */
  let settings: Config | null = null;
  // Pressing the knob opens a chart of the last hour; history is only fetched while it is open.
  let chartOpen = false;
  let history: Reading[] = [];
  // A brief overlay while using the knob.
  let toast: { text: string; index: number; count: number } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  // Just after switching views: the view's place in the list, shown on the bottom row.
  let viewDots: [number, number] | null = null;
  let dotsTimer: ReturnType<typeof setTimeout> | null = null;
  let knobSaveTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (toast) return toastFrame(toast.text, toast.index, toast.count);
    if (chartOpen && latest && cfg) return chartFrame(history, latest, cfg, Date.now());
    if (latest && cfg) return readingFrame(latest, deltaMgdl, extras, cfg, Date.now(), fx, viewDots);
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
      settings = await loadConfig(APP);
      cfg = withKnob(settings);
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
          // An hour of 5-minute readings while the chart is open, otherwise just enough for the delta.
          readings = await dexcom.readings(chartOpen ? 13 : 2);
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
          // Nightscout may carry 1-minute data: up to an hour of it.
          const fallback = await nightscout.readings(chartOpen ? 60 : 2);
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
        if (chartOpen) history = readings.filter((r) => newest.time - r.time <= CHART_MS);
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

  /** The settings with the knob's choices on top. Choices not saved yet are only in memory: they win over what was stored. */
  function withKnob(stored: Config): Config {
    const unsaved = knobSaveTimer && cfg ? { displayMode: cfg.displayMode, units: cfg.units } : null;
    return { ...applyKnob(stored), ...unsaved };
  }

  // Settings changed on the bar apply within SETTINGS_CHECK_MS. A changed login or URL needs a poll; the rest just a redraw.
  const settingsCheck = setInterval(() => {
    if (polling || !settings) return;
    void loadConfig(APP)
      .then((stored) => {
        if (stopped || polling) return;
        const login = (c: Config) => [c.username, c.password, c.region, c.nsUrl, c.nsToken].join("\n");
        const changed = JSON.stringify(stored) !== JSON.stringify(settings);
        const loginChanged = login(stored) !== login(settings!);
        const before = cfg?.displayMode;
        settings = stored;
        cfg = withKnob(stored);
        if (loginChanged) return schedule(0);
        if (cfg.displayMode !== before) fetchExtrasFor(cfg.displayMode);
        if (changed) void draw().catch(report);
      })
      .catch(report);
  }, SETTINGS_CHECK_MS);

  /** Shows an overlay for a moment, then the reading again. */
  function showToast(text: string, index = -1, count = 0): void {
    toast = { text, index, count };
    if (toastTimer) clearTimeout(toastTimer);
    if (dotsTimer) clearTimeout(dotsTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = null;
      void draw().catch(report);
    }, TOAST_MS);
    void draw().catch(report);
  }

  /** Saves the knob's choices once it has been still for a moment, or right away when quitting. */
  function saveKnob(now = false): void {
    if (knobSaveTimer) clearTimeout(knobSaveTimer);
    knobSaveTimer = null;
    const save = () => {
      knobSaveTimer = null;
      if (!cfg || !settings) return;
      rememberKnob("displayMode", cfg.displayMode, settings.displayMode);
      rememberKnob("units", cfg.units, settings.units);
    };
    if (now) save();
    else knobSaveTimer = setTimeout(save, KNOB_SAVE_MS);
  }

  /** Turning the knob steps through the views (and leaves the chart). */
  function turn(delta: number): void {
    if (!cfg) return;
    chartOpen = false;
    const views = availableViews(cfg);
    const at = Math.max(0, views.indexOf(cfg.displayMode));
    const next = (at + (delta > 0 ? 1 : -1) + views.length) % views.length;
    cfg = { ...cfg, displayMode: views[next] };
    if (latest) {
      // The new view shows straight away; dots on the bottom row say where it is in the list.
      viewDots = [next, views.length];
      if (dotsTimer) clearTimeout(dotsTimer);
      dotsTimer = setTimeout(() => {
        dotsTimer = null;
        viewDots = null;
        void draw().catch(report);
      }, DOTS_MS);
      void draw().catch(report);
    } else {
      // With no reading to show the view with, name it instead.
      showToast(viewLabel(views[next]), next, views.length);
    }
    saveKnob();
    fetchExtrasFor(views[next]);
  }

  /** IOB/COB are only fetched for the views that show them: on switching to one, get them now rather than at the next poll. */
  function fetchExtrasFor(view: Config["displayMode"]): void {
    if ((view !== "iob" && view !== "iob_cob") || !nightscout || extras) return;
    void nightscout
      .extras()
      .then((found) => {
        extras = found;
        if (!stopped) void draw().catch(report);
      })
      .catch(report);
  }

  /** Pressing opens or closes the chart of the last hour. Opening it fetches the hour right away. */
  function press(): void {
    chartOpen = !chartOpen;
    if (chartOpen) {
      history = latest ? [latest] : [];
      if (!polling) schedule(0);
    }
    void draw().catch(report);
  }

  /** Holding switches units. */
  function hold(): void {
    if (!cfg) return;
    cfg = { ...cfg, units: cfg.units === "mmol" ? "mgdl" : "mmol" };
    showToast(cfg.units === "mmol" ? "mmol/L" : "mg/dL");
    saveKnob();
  }

  /** When the knob (or Start) went down, to tell a press from a hold on release. */
  let pressedAt = 0;
  /** The last step the knob took, to drop contact bounce. */
  let lastTurn = { at: 0, direction: 0 };

  // Knob: turn for views, press for the chart, hold for units. Start does the same as pressing the knob. Back leaves the app.
  const unbind = listen("input", (event) => {
    if (stopped) return;
    if (event.key === "encoder") {
      const direction = event.action === "counterclockwise" ? -1 : 1;
      const now = Date.now();
      if (direction !== lastTurn.direction && now - lastTurn.at < BOUNCE_MS) return;
      lastTurn = { at: now, direction };
      return turn(direction);
    }
    if (event.key === "ok" || event.key === "start") {
      if (event.action === "press") pressedAt = Date.now();
      if (event.action === "release" && pressedAt) {
        const held = Date.now() - pressedAt;
        pressedAt = 0;
        return held >= HOLD_MS ? hold() : press();
      }
      // A "short" with no "press" before it (e.g. sent through the HTTP API) is a press.
      if (event.action === "short" && !pressedAt) return press();
      return;
    }
    if (event.key !== "back" || event.action !== "short") return;

    stopped = true;
    clearInterval(ticker);
    clearInterval(settingsCheck);
    if (animTimer) clearInterval(animTimer);
    if (pollTimer) clearTimeout(pollTimer);
    if (toastTimer) clearTimeout(toastTimer);
    if (knobSaveTimer) saveKnob(true);

    // Not detached from inside the handler itself: with nothing else left the unbind stops the app on the spot, while this handler is still running.
    setTimeout(unbind, 0);
  });
}

main();
