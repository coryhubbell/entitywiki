import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { operatorSession, assertSameOriginMutation } from "./operator-security.ts";

export async function getOperatorSession() {
  const incoming = new Headers(await headers());
  const host = incoming.get("host") ?? "";
  // The local mode is disabled on every non-loopback host regardless of headers.
  return operatorSession(incoming, `https://${host}`, env);
}

export async function requireOperator(request: Request) {
  const session = await operatorSession(request.headers, new URL(request.url).origin, env);
  if (!session) throw Object.assign(new Error("Operator sign-in is required."), { status: 403 });
  if (!["GET", "HEAD"].includes(request.method)) assertSameOriginMutation(request);
  return session;
}
