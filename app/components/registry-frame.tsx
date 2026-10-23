/* eslint-disable @next/next/no-html-link-for-pages -- Full document links preserve SSR authorization and avoid the current Vinext navigation defect. */

export function RegistryHeader({ workspace = false }: { workspace?: boolean }) {
  return (
    <header className="topbar registry-topbar">
      <a className="wordmark" href="/" aria-label="EntityWiki registry home">
        <span className="brand-symbol" aria-hidden="true">
          ✳
        </span>
        entitywiki<span className="brand-dot">.</span>
      </a>
      <span className="topbar-purpose">The evidence behind every entity.</span>
      <nav className="registry-navigation" aria-label="Main navigation">
        <a href="/" aria-current={workspace ? undefined : "page"}>
          Registry
        </a>
        <a href="https://entitywiki.com/">
          Platform <span aria-hidden="true">↗</span>
        </a>
        <a href="/admin" className={workspace ? "active" : ""}>
          Workspace <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}

export function RegistryFooter() {
  return (
    <footer className="registry-footer">
      <a className="wordmark" href="/">
        entitywiki<span className="brand-dot">.</span>
      </a>
      <p>Evidence. Identity. Meaning.</p>
      <div>
        <span className="overline">STAGING PREVIEW · INDEXING DISABLED</span>
        <a href="https://entitywiki.com/">Explore the platform ↗</a>
      </div>
    </footer>
  );
}

export function ProfileUnavailable() {
  return (
    <>
      <RegistryHeader />
      <main className="registry-main unavailable-main" id="main">
        <p className="overline">PUBLIC COMPANY DOSSIER</p>
        <h1>
          This record is
          <br />
          <em>awaiting release.</em>
        </h1>
        <p>
          The MAXPlaces dossier will appear here when an editorial release is
          available. Public profiles display the saved released revision and its
          evidence.
        </p>
        <a className="button" href="/">
          Explore the registry <span aria-hidden="true">↗</span>
        </a>
      </main>
      <RegistryFooter />
    </>
  );
}
