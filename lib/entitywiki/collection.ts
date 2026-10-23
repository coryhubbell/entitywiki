import type { CollectedPage } from "./types.ts";
import { assertOfficialUrl, boundedText, sha256, text } from "./safety.ts";
export const PILOT_URLS = ["https://www.maxplaces.com/", "https://www.maxplaces.com/ai-info/", "https://www.maxplaces.com/contact/", "https://www.maxplaces.com/entitymap/"] as const;
export function parsePublicHtml(html: string): { title: string; text: string; jsonld: unknown[] } {
  const jsonld: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { jsonld.push(JSON.parse(match[1])); } catch { /* A malformed source block is not executable. */ }
  }
  const visible = html.replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 120_000);
  return { title: text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "MAXPlaces source", 250), text: visible, jsonld };
}
export async function collectFirstParty(fetcher: typeof fetch = fetch): Promise<{ pages: CollectedPage[]; failures: string[] }> {
  const pages: CollectedPage[] = []; const failures: string[] = [];
  // Four bounded reads with a redirect check at every hop; no arbitrary URL fetch API.
  for (const initial of PILOT_URLS) {
    try {
      let url: string = initial; let response: Response | undefined;
      for (let hop = 0; hop <= 3; hop++) {
        assertOfficialUrl(url);
        response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "EntityWiki-Research/1.0 (+https://entitywiki.org/)" } });
        if (response.status >= 300 && response.status < 400) { const location = response.headers.get("location"); if (!location || hop === 3) throw new Error("Redirect limit"); url = assertOfficialUrl(new URL(location,url).href).href; await response.body?.cancel(); continue; }
        break;
      }
      if (!response?.ok) throw new Error("Source unavailable");
      const html = await boundedText(response);
      pages.push({ url: initial, finalUrl: url, ...parsePublicHtml(html), sha256: await sha256(html), retrievedAt: new Date().toISOString() });
    } catch { failures.push(`${initial}: collection unavailable; no claims fabricated.`); }
  }
  return { pages, failures };
}
