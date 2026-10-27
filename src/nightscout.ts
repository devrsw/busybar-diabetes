// Nightscout client: the public entries API, with an optional access token.

import { AuthError, parseTrend, type Reading, type Source } from "./reading";

export class Nightscout implements Source {
  private readonly base: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    // Accept "my-site.herokuapp.com" and trailing slashes.
    const trimmed = url.trim().replace(/\/+$/, "");
    this.base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    this.token = token.trim();
  }

  async readings(count: number): Promise<Reading[]> {
    let url = `${this.base}/api/v1/entries/sgv.json?count=${count}`;
    if (this.token) url += `&token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(this.token ? "Bad NS token" : "Set NS token");
    }
    if (response.status === 404) throw new AuthError("Bad NS URL");
    if (!response.ok) throw new Error(`Nightscout HTTP ${response.status}`);

    let raw: unknown;
    try {
      raw = JSON.parse(await response.text());
    } catch {
      // A web page instead of JSON: usually the URL points somewhere else.
      throw new AuthError("Bad NS URL");
    }
    if (!Array.isArray(raw)) throw new Error("Nightscout: unexpected response");

    const out: Reading[] = [];
    for (const item of raw as Record<string, unknown>[]) {
      const mgdl = Number(item.sgv);
      const time = Number(item.date ?? item.mills);
      if (!isFinite(mgdl) || !isFinite(time) || mgdl <= 0) continue;
      out.push({ mgdl, trend: parseTrend(item.direction), time });
    }
    return out;
  }
}
