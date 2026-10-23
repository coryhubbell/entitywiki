import type { Metadata } from "next";
import { pilotService } from "@/lib/pilot-runtime";
import { RegistryHeader, RegistryFooter } from "./components/registry-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "EntityWiki — The company knowledge registry",
  description:
    "Explore evidence-backed company records and the relationships between businesses, services, locations and concepts.",
  alternates: { canonical: "https://entitywiki.org/" },
  robots: { index: false, follow: false },
};

export default async function Home() {
  let profile: Awaited<
    ReturnType<ReturnType<typeof pilotService>["getProfile"]>
  > = null;
  try {
    profile = await pilotService().getProfile("maxplaces-marketing");
  } catch {
    /* An uninitialized registry shows its empty public state. */
  }
  const record = profile?.record;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to company registry
      </a>
      <RegistryHeader />
      <main className="registry-main" id="main">
        <section className="registry-hero">
          <div>
            <p className="overline">AN OPEN MAP OF COMPANY KNOWLEDGE</p>
            <h1>
              The knowledge
              <br />
              behind <em>the company.</em>
            </h1>
            <p>
              Businesses are more than a name and a website. Explore their
              services, locations and ideas through a connected record with
              evidence you can follow.
            </p>
            <a className="button" href="#directory">
              Explore the registry <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div
            className="registry-blueprint"
            role="img"
            aria-label="Companies connect to source evidence, services, locations and concepts"
          >
            <div className="blueprint-heading">
              <p className="overline">THE CONNECTED COMPANY</p>
              <span aria-hidden="true">↗</span>
            </div>
            <div className="blueprint-diagram" aria-hidden="true">
              <i className="blueprint-line line-a" />
              <i className="blueprint-line line-b" />
              <i className="blueprint-line line-c" />
              <i className="blueprint-line line-d" />
              <span className="blueprint-node node-a">
                Services<small>WHAT IT OFFERS</small>
              </span>
              <span className="blueprint-node node-b">
                Locations<small>WHERE IT OPERATES</small>
              </span>
              <span className="blueprint-node node-c">
                Concepts<small>WHAT IT CONNECTS TO</small>
              </span>
              <span className="blueprint-node node-d">
                Evidence<small>WHY IT IS HERE</small>
              </span>
              <strong className="blueprint-core">
                Company<span>ONE CONNECTED RECORD</span>
              </strong>
            </div>
            <p className="blueprint-caption">
              IDENTITY → RELATIONSHIPS → PROVENANCE
            </p>
          </div>
        </section>
        <section className="directory-section" id="directory">
          <div className="section-heading">
            <div>
              <p className="overline">THE PUBLIC REGISTRY</p>
              <h2>Companies, connected.</h2>
            </div>
            <span className="overline muted">
              {record ? "01 RELEASED DOSSIER" : "AWAITING FIRST RELEASE"}
            </span>
          </div>
          {record ? (
            <a href="/MAXPlaces_Marketing" className="directory-card">
              <div className="directory-monogram" aria-hidden="true">
                M<span>+</span>
              </div>
              <div className="directory-company">
                <span className="overline">
                  ORGANIZATION / DIGITAL MARKETING
                </span>
                <h3>{record.org.name}</h3>
                <p>
                  {record.org.description ||
                    "Explore the released MAXPlaces company record and its sourced relationships."}
                </p>
                <div className="directory-meta">
                  <span>
                    {record.coverage.assessedSections} sections assessed
                  </span>
                  <span>
                    {record.coverage.acceptedOntologyMappings} accepted ontology
                    mappings
                  </span>
                  <span>Record revision {record.revision}</span>
                </div>
              </div>
              <span className="directory-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : (
            <div className="directory-empty">
              <span className="overline">AN EVIDENCE-LED BEGINNING</span>
              <h3>The first record is taking shape.</h3>
              <p>
                Company dossiers appear here after an editorial release. Each
                release preserves the facts, evidence and open research
                questions together.
              </p>
            </div>
          )}
        </section>
        <section className="registry-principles">
          <div>
            <p className="overline">01 / EVIDENCE</p>
            <h3>Follow the source.</h3>
            <p>
              Claims carry their sources and dates. You can see what supports a
              statement and where research remains open.
            </p>
          </div>
          <div>
            <p className="overline">02 / IDENTITY</p>
            <h3>Keep the boundaries.</h3>
            <p>
              A company, a branch and a service have their own identities. Their
              connections stay specific and inspectable.
            </p>
          </div>
          <div>
            <p className="overline">03 / MEANING</p>
            <h3>Make the link matter.</h3>
            <p>
              Ontology mappings describe the right offering or concept. A
              relationship has a reason beyond a matching label.
            </p>
          </div>
        </section>
        <section className="registry-platform">
          <div>
            <p className="overline">
              FOR THE PEOPLE BUILDING COMPANY KNOWLEDGE
            </p>
            <h2>
              Bring your evidence.
              <br />
              <em>Build the connections.</em>
            </h2>
          </div>
          <a className="button secondary" href="https://entitywiki.com/">
            Explore the platform <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>
      <RegistryFooter />
    </>
  );
}
