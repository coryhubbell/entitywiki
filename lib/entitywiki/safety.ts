export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
export function text(value: unknown, limit = 2000): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, limit) : "";
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || /[\r\n\u0000]/.test(value)) return;
  try { const u = new URL(value); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return; return u.href; } catch { return; }
}
export function assertOfficialUrl(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== "https:" || !["maxplaces.com", "www.maxplaces.com"].includes(u.hostname) || u.port || u.username || u.password) throw new Error("Pilot acquisition is restricted to the official MAXPlaces HTTPS domain.");
  return u;
}
/** Explicit bounded reading prevents a provider or HTML document exhausting the Worker. */
export async function boundedText(response: Response, maxBytes = 2_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let size = 0; const parts: Uint8Array[] = [];
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) throw new Error("Source exceeded the configured response limit."); parts.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}
export function wikiText(value: unknown): string {
  // Character references are interpreted as text by MediaWiki after structural parsing.
  return text(value, 12_000).replace(/\r\n?/g,"\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;").replace(/\|/g, "&#124;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/~/g,"&#126;").replace(/^([=*:;#])/gm, "&#32;$1");
}
export function wikiLink(url: string, label: string): string {
  const safe = safeUrl(url); return safe ? `[${safe.replace(/[\s\[\]{}|<>]/g, c => encodeURIComponent(c)).replace(/~/g,"%7E")} ${wikiText(label)}]` : wikiText(label);
}
