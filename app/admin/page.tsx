/* eslint-disable @next/next/no-html-link-for-pages -- Full document links preserve SSR authorization and avoid the current Vinext navigation defect. */
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { localLoginEnabled } from "@/lib/operator-security";
import type { Metadata } from "next";
import { getOperatorSession } from "@/lib/operator-auth";
import { pilotService } from "@/lib/pilot-runtime";
import EntityWorkspace from "../components/entity-workspace";
import { RegistryHeader, RegistryFooter } from "../components/registry-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editorial workspace — EntityWiki",
  robots: { index: false, follow: false },
};

export default async function AdminWorkspace() {
  const session = await getOperatorSession();
  const requestHeaders = await headers();
  const localLogin = localLoginEnabled(
    `https://${requestHeaders.get("host") || ""}`,
    env,
  );
  if (!session)
    return (
      <>
        <RegistryHeader workspace />
        <main className="registry-main locked-workspace" id="main">
          <div className="access-symbol" aria-hidden="true">
            ↗
          </div>
          <p className="overline">PRIVATE EDITORIAL WORKSPACE</p>
          <h1>
            Evidence first.
            <br />
            <em>Authorized access.</em>
          </h1>
          <p>
            An authorized operator session is required to collect sources,
            review company revisions and release them to the registry.
          </p>
          <div className="access-note">
            <span className="overline">ACCESS REQUIRED</span>
            <p>
              Sign in through the configured access provider to open this
              workspace. Public dossiers remain available in the registry.
            </p>
          </div>
          {localLogin && (
            <form
              className="local-access-form"
              method="post"
              action="/admin/auth"
            >
              <label htmlFor="key">Local staging access key</label>
              <input
                id="key"
                name="key"
                type="password"
                required
                autoComplete="off"
              />
              <button className="button" type="submit">
                Open workspace <span aria-hidden="true">↗</span>
              </button>
            </form>
          )}
          <a className="button secondary" href="/">
            Return to the registry <span aria-hidden="true">↗</span>
          </a>
        </main>
        <RegistryFooter />
      </>
    );
  let profile: unknown = null;
  try {
    profile = await pilotService().getAdminProfile("maxplaces-marketing");
  } catch {
    /* Authenticated onboarding can initialize the first saved record. */
  }
  return (
    <>
      <div className="operator-session">
        <span>
          <i />
          PRIVATE WORKSPACE
        </span>
        <span className="operator-subject">{session.subject}</span>
        <a href="/MAXPlaces_Marketing">View released dossier ↗</a>
        {localLogin && (
          <form action="/admin/auth" method="post">
            <input type="hidden" name="action" value="logout" />
            <button type="submit">Sign out</button>
          </form>
        )}
      </div>
      <EntityWorkspace mode="admin" initialProfile={profile} />
    </>
  );
}
