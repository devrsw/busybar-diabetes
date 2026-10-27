import { device } from "@shared/device";
import { render, type Node } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { loadConfig, type Config } from "./config";
import { DexcomShare } from "./dexcom";
import { messageFrame, NUDGE, rangeColor, rangeOf, readingFrame } from "./display";
import { Nightscout } from "./nightscout";
import { AuthError, type Reading, type Source } from "./reading";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

/** Dexcom sensors report every 5 minutes; Share lags a little behind. */
const READING_INTERVAL_MS = 5 * 60 * 1000;
const SHARE_LAG_MS = 20 * 1000;
/** Nightscout has no login to protect and may carry 1-minute data: check every minute. */
const NIGHTSCOUT_POLL_MS = 60 * 1000;
/** When the expected reading hasn't shown up yet. */
const RETRY_MS = 30 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** Wrong credentials: retry rarely, Dexcom locks accounts after repeated failures. */
const AUTH_RETRY_MS = 10 * 60 * 1000;
/** Age is shown in whole minutes. */
const TICK_MS = 60 * 1000;
/** Arrow animation: rests for ANIM_REST_STEPS steps, then nudges one pixel for a step. */
const ANIM_STEP_MS = 400;
const ANIM_REST_STEPS = 4;

const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

function main(): void {
  let cfg: Config | null = null;
  let client: Source | null = null;
  let clientKey = "";
  let latest: Reading | null = null;
  let deltaMgdl: number | null = null;
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

  let animTimer: ReturnType<typeof setInterval> | null = null;
  let animStep = 0;
  /** Whether the arrow is nudged out on the current step. */
  const nudged = () => animTimer !== null && animStep % (ANIM_REST_STEPS + 1) === ANIM_REST_STEPS;

  function frame(): Node {
    if (latest && cfg) return readingFrame(latest, deltaMgdl, cfg, Date.now());
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
      const nudge = latest && NUDGE[latest.trend];
      if (nudge && nudged()) {
        for (const el of elements) {
          if (el.id !== "arrow") continue;
          el.x = (el.x ?? 0) + nudge[0];
          el.y = (el.y ?? 0) + nudge[1];
        }
      }
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

  /** Runs the arrow animation only while an arrow is on screen and it is turned on. */
  function animate(): void {
    const wanted = !stopped && !!cfg?.animateArrow && !!latest && !!NUDGE[latest.trend] && shown.has("arrow");
    if (wanted && !animTimer) {
      animStep = 0;
      animTimer = setInterval(() => {
        const was = nudged();
        animStep += 1;
        // Only the rest/nudge transitions change the screen.
        if (nudged() !== was) void draw().catch(report);
      }, ANIM_STEP_MS);
    } else if (!wanted && animTimer) {
      clearInterval(animTimer);
      animTimer = null;
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
    try {
      cfg = await loadConfig(APP);
      if (missingLogin(cfg)) {
        // Settings are local: check again soon (RETRY_MS) so new credentials show up quickly.
        throw new AuthError(cfg.source === "nightscout" ? "Set NS URL" : "Set Dexcom login");
      }
      const key =
        cfg.source === "nightscout"
          ? `ns\n${cfg.nsUrl}\n${cfg.nsToken}`
          : `dexcom\n${cfg.region}\n${cfg.username}\n${cfg.password}`;
      if (key !== clientKey) {
        clientKey = key;
        client =
          cfg.source === "nightscout"
            ? new Nightscout(cfg.nsUrl, cfg.nsToken)
            : new DexcomShare(cfg.username, cfg.password, cfg.region);
        latest = null;
        message = "Connecting...";
        void draw().catch(report);
      }

      const readings = await client!.readings(2);
      failures = 0;
      if (readings.length === 0) {
        latest = null;
        message = "No data";
      } else {
        const [newest, previous] = readings;
        latest = newest;
        // A delta across a gap in the data would mislead.
        deltaMgdl = previous && newest.time - previous.time < 11 * 60 * 1000 ? newest.mgdl - previous.mgdl : null;
        // Ask again right after the next reading should land.
        const maxWait = cfg.source === "nightscout" ? NIGHTSCOUT_POLL_MS : READING_INTERVAL_MS + SHARE_LAG_MS;
        const due = newest.time + READING_INTERVAL_MS + SHARE_LAG_MS - Date.now();
        next = due > 0 ? Math.min(due, maxWait) : RETRY_MS;
      }
    } catch (err) {
      report(err);
      if (err instanceof AuthError) {
        latest = null;
        message = err.message;
        next = cfg && missingLogin(cfg) ? RETRY_MS : AUTH_RETRY_MS;
      } else {
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

  // Redraws the age; the rest only changes when a reading comes in.
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

function missingLogin(cfg: Config): boolean {
  return cfg.source === "nightscout" ? !cfg.nsUrl : !cfg.username || !cfg.password;
}

main();
