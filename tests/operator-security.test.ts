import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { assertSameOriginMutation, createLocalSession, LOCAL_COOKIE, matchesLocalKey, operatorSession } from "../lib/operator-security.ts";

const origin = "http://127.0.0.1:8876";
const local = { OPERATOR_AUTH_MODE: "local", OPERATOR_LOCAL_KEY: "test-only-local-key-with-at-least-32-characters" };

test("anonymous requests and claimed preview identity do not confer operator access", async () => {
  const forged = new Headers({ "oai-authenticated-user-id": "owner", "cf-access-authenticated-user-email": "owner@example.com" });
  assert.equal(await operatorSession(forged, origin, {}), null);
  assert.equal(await operatorSession(forged, origin, local), null);
  assert.equal(await operatorSession(forged, "https://entitywiki.com", local), null);
});
test("local staging session is encrypted, authenticated, key-bound and loopback-only", async () => {
  const token = await createLocalSession(origin, local);
  assert.equal(token.split(".").length, 5);
  assert.equal(token.includes("local-staging-operator"), false);
  const headers = new Headers({ cookie: `${LOCAL_COOKIE}=${token}` });
  assert.deepEqual(await operatorSession(headers, origin, local), { subject: "local-staging-operator" });
  assert.equal(await operatorSession(headers, "https://entitywiki.org", local), null);
  assert.equal(await operatorSession(headers, origin, { ...local, OPERATOR_LOCAL_KEY: `${local.OPERATOR_LOCAL_KEY}-rotated` }), null);
  assert.equal(await matchesLocalKey("wrong", local.OPERATOR_LOCAL_KEY), false);
  await assert.rejects(createLocalSession("https://entitywiki.com", local));
});
test("cookie-authenticated mutations require an exact origin, including logout", () => {
  for (const headers of [{}, { origin: "https://evil.example" }, { origin, "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
    assert.throws(() => assertSameOriginMutation(new Request(`${origin}/api/releases`, { method: "POST", headers })), /same-origin/);
  }
  assert.doesNotThrow(() => assertSameOriginMutation(new Request(`${origin}/api/releases`, { method: "POST", headers: { origin } })));
});
test("Access JWT requires a trusted signature, issuer, audience, expiry and allowed operator", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const key = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...key, kid: "fixture", alg: "RS256", use: "sig" }] });
  const config = { OPERATOR_AUTH_MODE: "cloudflare-access", ACCESS_TEAM_DOMAIN: "https://entitywiki-test.cloudflareaccess.com", ACCESS_AUDIENCE: "fixture-admin-audience", ACCESS_OPERATOR_EMAILS: "owner@example.com" };
  const sign = (email = "owner@example.com", audience = config.ACCESS_AUDIENCE, expiry = "1h", issuer = config.ACCESS_TEAM_DOMAIN) => new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(issuer).setAudience(audience).setSubject("verified-user").setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  const session = async (token: string) => operatorSession(new Headers({ "cf-access-jwt-assertion": token }), "https://entitywiki.com", config, keys);
  assert.deepEqual(await session(await sign()), { subject: "verified-user" });
  assert.equal(await session(await sign("other@example.com")), null);
  assert.equal(await session(await sign("owner@example.com", "other-app")), null);
  assert.equal(await session(await sign("owner@example.com", config.ACCESS_AUDIENCE, "-1h")), null);
  assert.equal(await session(await sign("owner@example.com", config.ACCESS_AUDIENCE, "1h", "https://evil.example")), null);
  assert.equal(await session(`${await sign()}tampered`), null);
  assert.equal(await operatorSession(new Headers(), origin, config, keys), null);
  assert.equal(await operatorSession(new Headers({ "cf-access-jwt-assertion": await sign() }), origin, { ...config, ACCESS_TEAM_DOMAIN: "https://evil.example" }, keys), null);
});
