import type { Metadata } from "next";
import EntityWorkspace from "../components/entity-workspace";
import { ProfileUnavailable } from "../components/registry-frame";
import { pilotService } from "@/lib/pilot-runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "MAXPlaces Marketing — EntityWiki",
  description:
    "Explore the released MAXPlaces Marketing company dossier, its sources, services, branch identities and semantic mappings.",
  alternates: { canonical: "https://entitywiki.org/MAXPlaces_Marketing" },
  openGraph: {
    title: "MAXPlaces Marketing — EntityWiki",
    url: "https://entitywiki.org/MAXPlaces_Marketing",
    type: "website",
  },
  robots: { index: false, follow: false },
};

export default async function MaxPlacesProfile() {
  let profile: Awaited<
    ReturnType<ReturnType<typeof pilotService>["getProfile"]>
  > = null;
  try {
    profile = await pilotService().getProfile("maxplaces-marketing");
  } catch {
    /* No public payload is synthesized from a pending record. */
  }
  if (!profile) return <ProfileUnavailable />;
  const safeJson = JSON.stringify(profile.jsonld)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson }}
      />
      <EntityWorkspace mode="public" initialProfile={profile} />
    </>
  );
}
