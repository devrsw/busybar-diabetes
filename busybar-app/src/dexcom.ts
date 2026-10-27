// Dexcom Share client: the same endpoints the Dexcom Follow app uses.
// Needs Share turned on in the Dexcom app, with at least one follower.

export type Region = "us" | "ous" | "jp";

import { AuthError, parseTrend, type Reading, type Source } from "./reading";

const SERVERS: Record<Region, { base: string; appId: string }> = {
  us: {
    base: "https://share2.dexcom.com/ShareWebServices/Services",
    appId: "d89443d2-327c-4a6f-89e5-496bbb0317db",
  },
  ous: {
    base: "https://shareous1.dexcom.com/ShareWebServices/Services",
    appId: "d89443d2-327c-4a6f-89e5-496bbb0317db",
  },
  jp: {
    base: "https://share.dexcom.jp/ShareWebServices/Services",
    appId: "d8665ade-9673-4e27-9ff6-92db4ce13d13",
  },
};

const NULL_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dexcom error codes that mean the credentials or account need attention. */
const AUTH_CODES = [
  "AccountPasswordInvalid",
  "SSO_AuthenticateAccountNotFound",
  "SSO_AuthenticatePasswordInvalid",
  "SSO_AuthenticateMaxAttemptsExceeed",
  "SSO_InternalError",
];

class DexcomRequestError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class DexcomShare implements Source {
  private readonly username: string;
  private readonly password: string;
  private readonly region: Region;
  private sessionId: string | null = null;
  private accountId: string | null = null;

  constructor(username: string, password: string, region: Region) {
    this.username = username;
    this.password = password;
    this.region = region;
  }

  /** The latest readings, newest first; at most `count`, from the last `minutes`. */
  async readings(count: number, minutes = 24 * 60): Promise<Reading[]> {
    if (!this.sessionId) await this.login();
    try {
      return await this.fetchReadings(count, minutes);
    } catch (err) {
      // Sessions expire after a while; log in again once.
      if (err instanceof DexcomRequestError && err.code.startsWith("Session")) {
        this.sessionId = null;
        await this.login();
        return this.fetchReadings(count, minutes);
      }
      throw err;
    }
  }

  private async fetchReadings(count: number, minutes: number): Promise<Reading[]> {
    const raw = await this.post(
      `/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${this.sessionId}&minutes=${minutes}&maxCount=${count}`,
      null,
    );
    if (!Array.isArray(raw)) throw new Error("Dexcom: unexpected readings response");
    const out: Reading[] = [];
    for (const item of raw as Record<string, unknown>[]) {
      const reading = parseReading(item);
      if (reading) out.push(reading);
    }
    return out;
  }

  private async login(): Promise<void> {
    const { appId } = SERVERS[this.region];
    if (!this.username || !this.password) {
      throw new AuthError("Set Dexcom login");
    }
    try {
      if (!this.accountId) {
        // A Dexcom account id can be entered in place of the username.
        this.accountId = UUID.test(this.username)
          ? this.username
          : await this.postId("/General/AuthenticatePublisherAccount", {
              accountName: this.username,
              password: this.password,
              applicationId: appId,
            });
      }
      this.sessionId = await this.postId("/General/LoginPublisherAccountById", {
        accountId: this.accountId,
        password: this.password,
        applicationId: appId,
      });
    } catch (err) {
      if (err instanceof DexcomRequestError && AUTH_CODES.indexOf(err.code) >= 0) {
        throw new AuthError(err.code.indexOf("MaxAttempts") >= 0 ? "Dexcom locked" : "Bad login");
      }
      throw err;
    }
  }

  private async postId(path: string, body: object): Promise<string> {
    const id = await this.post(path, body);
    if (typeof id !== "string" || id === NULL_ID) throw new AuthError("Bad login");
    return id;
  }

  private async post(path: string, body: object | null): Promise<unknown> {
    const response = await fetch(SERVERS[this.region].base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Dexcom Share/3.0.2.11",
      },
      body: body ? JSON.stringify(body) : "",
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON; handled below.
    }
    if (!response.ok) {
      const code = (data as { Code?: unknown } | null)?.Code;
      throw new DexcomRequestError(`Dexcom HTTP ${response.status}`, typeof code === "string" ? code : "");
    }
    return data;
  }
}

function parseReading(item: Record<string, unknown>): Reading | null {
  const mgdl = Number(item.Value);
  // WT looks like "Date(1691455258000)" or "/Date(1691455258000-0400)/".
  const match = /Date\((\d+)/.exec(String(item.WT ?? item.ST ?? ""));
  if (!isFinite(mgdl) || !match) return null;
  return { mgdl, trend: parseTrend(item.Trend), time: Number(match[1]) };
}

