import { env } from "cloudflare:workers";
import { assertSameOriginMutation, createLocalSession, LOCAL_COOKIE, localLoginEnabled, matchesLocalKey } from "../../../lib/operator-security";

export async function POST(request: Request) {
  try { assertSameOriginMutation(request); } catch { return new Response("Operator request rejected.", { status: 403 }); }
  const origin = new URL(request.url).origin;
  if (!localLoginEnabled(origin, env)) return new Response("Use the configured operator identity provider.", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return new Response("Request too large.", { status: 413 });
  const text = await request.text();
  if (text.length > 4096) return new Response("Request too large.", { status: 413 });
  const form = new URLSearchParams(text);
  if (form.get("action") === "logout") return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": `${LOCAL_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, "Cache-Control": "no-store" } });
  if (!await matchesLocalKey(form.get("key") ?? "", env.OPERATOR_LOCAL_KEY!)) return new Response("Operator sign-in failed.", { status: 403, headers: { "Cache-Control": "no-store" } });
  const token = await createLocalSession(origin, env);
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": `${LOCAL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${origin.startsWith("https:") ? "; Secure" : ""}`, "Cache-Control": "no-store" } });
}
