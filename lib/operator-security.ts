import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

export interface OperatorConfig {
  OPERATOR_AUTH_MODE?: string;
  OPERATOR_LOCAL_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  ACCESS_OPERATOR_EMAILS?: string;
}
export interface OperatorSession { subject: string }
export const LOCAL_COOKIE = "entitywiki_local_operator";
const localIssuer = "entitywiki-local-staging";
const localAudience = "entitywiki-admin";
const keySets = new Map<string, JWTVerifyGetKey>();

export function isLocalOrigin(origin: string): boolean {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname); }
  catch { return false; }
}
export function localLoginEnabled(origin: string, config: OperatorConfig): boolean {
  return config.OPERATOR_AUTH_MODE === "local" && isLocalOrigin(origin) && (config.OPERATOR_LOCAL_KEY?.length ?? 0) >= 32;
}
async function localKey(secret: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
}
export async function matchesLocalKey(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([localKey(supplied), localKey(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export async function createLocalSession(origin: string, config: OperatorConfig): Promise<string> {
  if (!localLoginEnabled(origin, config)) throw new Error("Local operator access is disabled.");
  return new EncryptJWT({}).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject("local-staging-operator").setIssuer(localIssuer).setAudience(localAudience)
    .setIssuedAt().setExpirationTime("1h").setJti(crypto.randomUUID())
    .encrypt(await localKey(config.OPERATOR_LOCAL_KEY!));
}
function cookie(headers: Headers, name: string): string | null {
  const value = headers.get("cookie")?.split(";").find(part => part.trim().startsWith(`${name}=`));
  return value ? value.trim().slice(name.length + 1) : null;
}
/** Identity is checked at the origin, even when an access proxy is configured. */
export async function operatorSession(headers: Headers, origin: string, config: OperatorConfig, testKeys?: JWTVerifyGetKey): Promise<OperatorSession | null> {
  try {
    if (localLoginEnabled(origin, config)) {
      const token = cookie(headers, LOCAL_COOKIE);
      if (!token) return null;
      const { payload } = await jwtDecrypt(token, await localKey(config.OPERATOR_LOCAL_KEY!), {
        issuer: localIssuer, audience: localAudience, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"], requiredClaims: ["exp", "iat", "sub"],
      });
      return payload.sub === "local-staging-operator" ? { subject: payload.sub } : null;
    }
    if (config.OPERATOR_AUTH_MODE !== "cloudflare-access") return null;
    const team = new URL(config.ACCESS_TEAM_DOMAIN ?? "");
    if (team.protocol !== "https:" || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team.hostname) || team.pathname !== "/" || team.port || team.username || team.password || team.search || team.hash) return null;
    const audience = config.ACCESS_AUDIENCE;
    const allowed = (config.ACCESS_OPERATOR_EMAILS ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
    if (!audience || !allowed.length) return null;
    const token = headers.get("cf-access-jwt-assertion");
    if (!token || token.length > 16_384) return null;
    let keys = testKeys ?? keySets.get(team.origin);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", team), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 300_000 });
      keySets.set(team.origin, keys);
    }
    const { payload } = await jwtVerify(token, keys, { issuer: team.origin, audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "email"] });
    if (typeof payload.email !== "string" || !allowed.includes(payload.email.toLowerCase()) || !payload.sub) return null;
    return { subject: payload.sub };
  } catch { return null; }
}

export function assertSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw Object.assign(new Error("A same-origin operator request is required."), { status: 403 });
  }
}
