"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full document links preserve SSR authorization and avoid the current Vinext navigation defect. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type Item = Record<string, unknown>;
const emptyRecord: Item = {};
type View =
  | "profile"
  | "graph"
  | "evidence"
  | "mappings"
  | "json"
  | "publisher";
type Inspector = { title: string; subtitle: string; data: unknown };
type GraphNode = {
  id: string;
  label: string;
  kind: string;
  relation: string;
  data: Item;
};
type Profile = {
  record: Item;
  jsonld: unknown;
  graph: Item;
  publication: Item;
  webRelease: Item;
};
const sections = [
  ["overview", "Overview"],
  ["company_identity", "Company identity"],
  ["history", "History"],
  ["team", "People & team"],
  ["services", "Services"],
  ["products", "Products & software"],
  ["framework", "Framework & methodology"],
  ["locations", "Locations"],
  ["service_areas", "Service areas"],
  ["google_business_profile", "Google business mapping"],
  ["external_links", "External identity"],
  ["ontology", "Ontology & concepts"],
  ["gallery", "Media & gallery"],
  ["sources", "Sources & provenance"],
];
const views: [View, string][] = [
  ["profile", "Profile"],
  ["graph", "Entity graph"],
  ["evidence", "Evidence"],
  ["mappings", "Mappings"],
  ["json", "JSON-LD"],
  ["publisher", "Publisher"],
];
const adminRecordUrl = "/api/records/maxplaces-marketing";
const publicRecordUrl = "/api/public/records/maxplaces-marketing";
const scanRequestStorageKey =
  "entitywiki:registry:maxplaces:scan-submission:v1";
const scanOperationStorageKey =
  "entitywiki:registry:maxplaces:scan-operation:v1";
const object = (value: unknown): Item =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Item)
    : {};
const string = (value: unknown, fallback = ""): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : fallback;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const items = (value: unknown): Item[] =>
  Array.isArray(value)
    ? value.map(object)
    : Object.entries(object(value)).map(([id, entry]) => ({
        id,
        ...object(entry),
      }));
const human = (value: string) =>
  value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const text = (value: unknown): string => {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" · ");
  const v = object(value);
  return (
    string(
      v.name || v.label || v.text || v.description || v.value || v.summary,
    ) || JSON.stringify(value)
  );
};
const safeUrl = (value: unknown) => {
  try {
    const u = new URL(string(value));
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const label = (entry: Item, fallback = "Record") =>
  string(entry.name || entry.label || entry.title || entry.id, fallback);
const status = (entry: Item) =>
  string(
    entry.status || entry.state || entry.decision,
    array(entry.unresolvedFields).length
      ? "conflicted"
      : array(entry.sourceIds).length
        ? "sourced"
        : "needs_research",
  );
const ids = (entry: Item, key: string) =>
  array(entry[key] || entry[key.replace("Ids", "IDs")])
    .map((v) => string(v))
    .filter(Boolean);
const date = (value: unknown) => {
  const d = new Date(string(value));
  return Number.isNaN(d.valueOf())
    ? string(value, "Not recorded")
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "America/Chicago",
      });
};

async function request(
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(
    path,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(data),
        },
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Request returned ${response.status}; no readable response was received.`,
    );
  }
  if (!response.ok) {
    const error = object(body);
    throw new Error(
      string(
        error.message ||
          object(error.error).message ||
          error.error ||
          error.reason,
        `Request could not complete (${response.status}).`,
      ),
    );
  }
  return object(body);
}

function State({ value }: { value: string }) {
  return (
    <span
      className={`state state-${value.toLowerCase().replace(/[^a-z_]/g, "")}`}
    >
      <i />
      {value.replace(/_/g, " ")}
    </span>
  );
}
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="overline">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
function Details({ data }: { data: unknown }) {
  if (Array.isArray(data))
    return (
      <ul className="detail-list">
        {data.map((entry, i) => (
          <li key={i}>
            <Details data={entry} />
          </li>
        ))}
      </ul>
    );
  if (data && typeof data === "object")
    return (
      <dl className="detail-fields">
        {Object.entries(object(data))
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([key, value]) => (
            <div key={key}>
              <dt>{human(key)}</dt>
              <dd>
                {typeof value === "object" ? (
                  <Details data={value} />
                ) : (
                  <Details data={value} />
                )}
              </dd>
            </div>
          ))}
      </dl>
    );
  const value = text(data);
  const url = safeUrl(value);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {value} ↗
    </a>
  ) : (
    <span>{value || "Not recorded"}</span>
  );
}

function EvidenceDrawer({
  inspector,
  close,
}: {
  inspector: Inspector;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  return (
    <dialog
      className="evidence-drawer"
      ref={dialog}
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      aria-labelledby="inspector-title"
    >
      <div className="drawer-content">
        <div className="drawer-top">
          <span className="overline">EVIDENCE INSPECTOR</span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close evidence inspector"
            autoFocus
          >
            ×
          </button>
        </div>
        <p className="overline muted">{inspector.subtitle}</p>
        <h2 id="inspector-title">{inspector.title}</h2>
        <Details data={inspector.data} />
      </div>
    </dialog>
  );
}

function Graph({
  nodes,
  selected,
  select,
  compact = false,
  filter = "all",
  anchorId,
  anchorLabel,
}: {
  nodes: GraphNode[];
  selected: string;
  select: (node: GraphNode) => void;
  compact?: boolean;
  filter?: string;
  anchorId: string;
  anchorLabel: string;
}) {
  const visible = nodes.filter(
    (node) => filter === "all" || node.kind === filter,
  );
  const shown = visible.slice(0, compact ? 9 : 18);
  // Include each shown node's actual parent. A concept can describe a service rather than the organization.
  const parents = shown
    .flatMap((node) => {
      const parentId = string(object(node.data.relationship).source);
      const parent = nodes.find((candidate) => candidate.id === parentId);
      return parent && !shown.some((candidate) => candidate.id === parent.id)
        ? [parent]
        : [];
    })
    .filter(
      (node, index, entries) =>
        entries.findIndex((candidate) => candidate.id === node.id) === index,
    );
  const plotted = [...shown, ...parents];
  const positions = new Map(
    plotted.map((node, index) => {
      const angle =
        (index / Math.max(plotted.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return [
        node.id,
        { x: 330 + Math.cos(angle) * 220, y: 220 + Math.sin(angle) * 145 },
      ];
    }),
  );
  return (
    <div className={`network ${compact ? "network-compact" : ""}`}>
      <svg
        viewBox="0 0 660 440"
        role="img"
        aria-label={`Company graph showing ${shown.length} relationships. Use the relationship list to inspect every node.`}
      >
        <defs>
          <pattern
            id={compact ? "grid-mini" : "grid-full"}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" fill="#45604a" />
          </pattern>
        </defs>
        <rect
          width="660"
          height="440"
          fill={`url(#${compact ? "grid-mini" : "grid-full"})`}
        />
        {plotted.map((node) => {
          const point = positions.get(node.id)!;
          const relationship = object(node.data.relationship);
          const parentId = string(relationship.source);
          const parent =
            parentId === anchorId
              ? { x: 330, y: 220 }
              : positions.get(parentId);
          return parent ? (
            <line
              key={`edge-${node.id}`}
              x1={parent.x}
              y1={parent.y}
              x2={point.x}
              y2={point.y}
              stroke="#49634b"
            />
          ) : null;
        })}
        {plotted.map((node) => {
          const { x, y } = positions.get(node.id)!;
          return (
            <g
              key={node.id}
              className={`network-node node-${node.kind} ${selected === node.id ? "selected" : ""}`}
              onClick={() => select(node)}
            >
              <circle cx={x} cy={y} r={node.kind === "location" ? 13 : 9} />
              <text x={x} y={y + 27} textAnchor="middle">
                {node.label.length > 25
                  ? `${node.label.slice(0, 23)}…`
                  : node.label}
              </text>
            </g>
          );
        })}
        <g className="network-anchor">
          <rect x="252" y="185" width="156" height="70" rx="2" />
          <text x="330" y="214" textAnchor="middle">
            {anchorLabel.replace(/ Marketing.*$/, "").slice(0, 16)}
          </text>
          <text x="330" y="236" textAnchor="middle" className="anchor-sub">
            ORGANIZATION
          </text>
        </g>
      </svg>
      {!shown.length && (
        <p className="network-empty">
          Relationships will appear when the record contains sourced entities.
        </p>
      )}
      <div className="network-legend">
        <span>
          <i />
          Services
        </span>
        <span>
          <i className="legend-location" />
          Locations
        </span>
        <span>
          <i className="legend-concept" />
          Concepts
        </span>
        <span className="network-count">{visible.length} RELATIONSHIPS</span>
      </div>
    </div>
  );
}

function profileFrom(value: unknown): Profile {
  const data = object(value);
  return {
    record: object(data.record),
    jsonld: data.jsonld,
    graph: object(data.graph),
    publication: object(data.publication),
    webRelease: object(data.webRelease),
  };
}

export default function EntityWorkspace({
  mode = "public",
  initialProfile = null,
}: {
  mode?: "public" | "admin";
  initialProfile?: unknown;
}) {
  const isAdmin = mode === "admin";
  const recordUrl = isAdmin ? adminRecordUrl : publicRecordUrl;
  const availableViews = views.filter(
    ([key]) => isAdmin || key !== "publisher",
  );
  const [profile, setProfile] = useState<Profile | null>(() =>
    initialProfile ? profileFrom(initialProfile) : null,
  );
  const [loading, setLoading] = useState(!initialProfile);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(isAdmin ? "publisher" : "profile");
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const [query, setQuery] = useState("");
  const [sectionStatus, setSectionStatus] = useState("all");
  const [graphFilter, setGraphFilter] = useState("all");
  const [selectedNode, setSelectedNode] = useState("");
  const [toast, setToast] = useState("");
  const loaded = useRef(!!initialProfile);
  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    setError("");
    try {
      const data = await request(recordUrl);
      setProfile(profileFrom(data));
      loaded.current = true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The company record could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [recordUrl]);
  useEffect(() => {
    if (initialProfile) return;
    let active = true;
    void request(recordUrl)
      .then((data) => {
        if (!active) return;
        setProfile(profileFrom(data));
        loaded.current = true;
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "The company record could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordUrl, initialProfile]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const record = profile?.record || emptyRecord;
  const org = object(record.org);
  const sectionMap = object(record.sections);
  const sources = items(record.sources);
  const claims = items(record.claims);
  const offerings = items(record.services);
  const services = offerings.filter((offering) => offering.kind === "Service");
  const products = offerings.filter((offering) =>
    ["Product", "SoftwareApplication"].includes(string(offering.kind)),
  );
  const locations: Item[] = items(record.locations).map((location) => ({
    ...location,
    google:
      items(record.google).find(
        (mapping) => mapping.branchId === location.id,
      ) || {},
  }));
  const mappings = items(record.concepts);
  const concepts = mappings.filter(
    (mapping) =>
      mapping.authority !== "publisher" &&
      mapping.relation !== "exact_identity",
  );
  const externalIdentities = mappings.filter(
    (mapping) => mapping.relation === "exact_identity",
  );
  const conflicts = items(record.conflicts);
  const provenance = object(record.provenance);
  const coverage = object(record.coverage);
  const webRelease = profile?.webRelease || emptyRecord;
  const publication = Object.keys(profile?.publication || {}).length
    ? profile!.publication
    : object(record.publication);
  const organizationName = string(
    record.name || org.name,
    "MAXPlaces Marketing",
  );
  const companyUrl = safeUrl(org.url || record.url);
  const nodes = useMemo<GraphNode[]>(() => {
    const graphNodes = items(profile?.graph.nodes);
    const graphEdges = items(profile?.graph.edges);
    const entities = [
      ...items(record.entities),
      ...items(record.services),
      ...items(record.locations),
      ...items(record.concepts),
    ];
    if (graphNodes.length)
      return graphNodes
        .filter((node) => string(node.type) !== "organization")
        .map((node, i) => {
          const id = string(node.id, `node-${i}`);
          const entity = entities.find((entry) => entry.id === id) || {};
          const edge = graphEdges.find((entry) => entry.target === id) || {};
          return {
            id,
            label: label(node),
            kind: string(node.type, "concept").replace("branch", "location"),
            relation: string(edge.label || edge.type, "relatedTo"),
            data: {
              ...node,
              ...entity,
              relationship: {
                ...edge,
                sourceLabel: label(
                  graphNodes.find(
                    (candidate) => candidate.id === edge.source,
                  ) || {},
                  "Organization",
                ),
              },
            },
          };
        });
    const result: GraphNode[] = [];
    const add = (entries: Item[], kind: string, relation: string) =>
      entries.forEach((entry, i) =>
        result.push({
          id: string(entry.id, `${kind}-${i}`),
          label: label(entry, human(kind)),
          kind,
          relation,
          data: entry,
        }),
      );
    add(
      items(record.services).filter((offering) => offering.kind === "Service"),
      "service",
      "providesService",
    );
    add(
      items(record.services).filter((offering) =>
        ["Product", "SoftwareApplication"].includes(string(offering.kind)),
      ),
      "product",
      "offers",
    );
    add(items(record.locations), "location", "hasLocation");
    add(
      items(record.concepts).filter(
        (mapping) =>
          mapping.authority !== "publisher" &&
          mapping.relation !== "exact_identity",
      ),
      "concept",
      "hasConcept",
    );
    return result;
  }, [record, profile]);
  const activeNode = nodes.find((n) => n.id === selectedNode) || nodes[0];
  const inspect = (
    title: string,
    data: unknown,
    subtitle = "SOURCE & CLAIM RECORD",
  ) => {
    const entry = object(data);
    const referencedClaims = claims.filter((claim) =>
      ids(entry, "claimIds").includes(string(claim.id)),
    );
    const sourceIds = [
      ...ids(entry, "sourceIds"),
      ...referencedClaims.flatMap((claim) => ids(claim, "sourceIds")),
    ];
    const referencedSources = sources.filter((source) =>
      sourceIds.includes(string(source.id)),
    );
    setInspector({
      title,
      subtitle,
      data:
        referencedClaims.length || referencedSources.length
          ? {
              ...entry,
              ...(referencedClaims.length ? { referencedClaims } : {}),
              ...(referencedSources.length ? { referencedSources } : {}),
            }
          : data,
    });
  };
  const selectNode = (node: GraphNode) => {
    setSelectedNode(node.id);
  };
  const changeView = (next: View) => {
    if (!isAdmin && next === "publisher") return;
    setView(next);
    setQuery("");
  };
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = availableViews.findIndex(([key]) => key === view);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? availableViews.length - 1
          : (current +
              (event.key === "ArrowRight" ? 1 : -1) +
              availableViews.length) %
            availableViews.length;
    changeView(availableViews[index][0]);
    document.getElementById(`tab-${availableViews[index][0]}`)?.focus();
  };
  const displayedSections = sections.filter(([key, title]) => {
    const section = object(sectionMap[key]);
    return (
      (sectionStatus === "all" || status(section) === sectionStatus) &&
      `${title} ${key} ${text(section)}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const sourceButton = (entry: Item, title = "Inspect evidence") => (
    <button className="text-button" onClick={() => inspect(title, entry)}>
      Evidence <Arrow />
    </button>
  );
  const sectionContent = (key: string) => {
    const section = object(sectionMap[key]);
    const content = section.content || section.summary || section.text;
    const linkedClaims = claims.filter((claim) =>
      ids(section, "claimIds").includes(string(claim.id)),
    );
    if (content) return <p className="section-copy">{text(content)}</p>;
    if (linkedClaims.length)
      return (
        <ul className="claim-list">
          {linkedClaims.map((claim, i) => (
            <li key={string(claim.id, String(i))}>
              <button
                onClick={() =>
                  inspect(label(claim, human(key)), claim, "ATTRIBUTED CLAIM")
                }
              >
                {text(
                  claim.value ||
                    claim.statement ||
                    claim.description ||
                    claim.text ||
                    claim,
                )}
                <Arrow />
              </button>
            </li>
          ))}
        </ul>
      );
    return (
      <p className="section-copy muted">
        {string(
          section.reason || section.statusReason,
          "Research has not yet supplied publishable content for this section.",
        )}
      </p>
    );
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to company record
      </a>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="EntityWiki home">
          <span className="brand-symbol" aria-hidden="true">
            ✳
          </span>
          entitywiki<span className="brand-dot">.</span>
        </a>
        <span className="topbar-purpose">
          The evidence behind every entity.
        </span>
        <div className="topbar-status">
          <i />
          {isAdmin ? "PRIVATE WORKSPACE" : "PUBLIC REGISTRY"}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="overline">THE COMPANY GRAPH / 001</p>
          <div className="entity-stamp" aria-hidden="true">
            M<span>+</span>
          </div>
          <h2 className="sidebar-name">{organizationName}</h2>
          <p className="sidebar-sub">Organization · Evidence record</p>
          {companyUrl && (
            <a
              className="website-link"
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {new URL(companyUrl).hostname.replace(/^www\./, "")}
              <Arrow />
            </a>
          )}
          <div className="sidebar-rule" />
          <p className="overline">PROFILE CONTENTS</p>
          <nav className="section-nav" aria-label="Company sections">
            {sections.map(([key, title], i) => (
              <a
                key={key}
                href={`#section-${key}`}
                onClick={() => changeView("profile")}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {title}
                <i
                  className={`nav-status status-${status(object(sectionMap[key]))}`}
                />
              </a>
            ))}
          </nav>
          <div className="sidebar-note">
            <p className="overline">ONE RECORD. EVERY VIEW.</p>
            <p>
              Collected.
              <br />
              Connected.
              <br />
              <em>Accountable.</em>
            </p>
            <small>
              {isAdmin
                ? "Profile, graph and structured data share the saved revision under review."
                : "Profile, graph and structured data share one released evidence record."}
            </small>
            {isAdmin ? (
              <button
                className="text-button"
                onClick={() => changeView("publisher")}
              >
                Open release workspace <Arrow />
              </button>
            ) : (
              <a className="text-button" href="/">
                Explore the registry <Arrow />
              </a>
            )}
          </div>
          <div className="sidebar-footer overline">
            ENTITYWIKI × SCHEMABRAINS
            <br />
            VERSIONED KNOWLEDGE
          </div>
        </aside>
        <main id="main">
          <div className="breadcrumb overline">
            <span>ENTITYWIKI</span>
            <span>/</span>
            <span>ORGANIZATIONS</span>
            <span>/</span>
            <strong>MAXPLACES</strong>
          </div>
          <div className="page-heading">
            <div>
              <p className="overline">KNOWLEDGE THAT CONNECTS.</p>
              <h1>
                {organizationName.replace(/ Marketing(?:,? LLC)?$/i, "")}
                <br className="mobile-break" />
                <em>
                  {/Marketing/i.test(organizationName) ? " Marketing" : ""}
                </em>
                <span className="entity-marker" aria-hidden="true">
                  ↗
                </span>
              </h1>
            </div>
            <button
              className="button secondary"
              onClick={() =>
                inspect("Record provenance", {
                  id: record.id,
                  revision: record.revision,
                  provenance: record.provenance,
                  publication,
                })
              }
              disabled={!profile}
            >
              Trace the record <Arrow />
            </button>
          </div>
          <div className="profile-meta">
            <State
              value={
                isAdmin
                  ? string(record.status, loading ? "loading" : "unavailable")
                  : profile
                    ? "released"
                    : loading
                      ? "loading"
                      : "unavailable"
              }
            />
            <span>
              {record.revision
                ? `Record revision ${text(record.revision)}`
                : "Versioned company record"}
            </span>
            <span>
              {webRelease.releasedAt
                ? `Released ${date(webRelease.releasedAt)}`
                : record.acceptedAt
                  ? `Accepted ${date(record.acceptedAt)}`
                  : "Source dates travel with each claim"}
            </span>
            <span className="meta-warning">
              Sourced does not mean independently verified
            </span>
          </div>
          <div
            className="tabbar"
            role="tablist"
            aria-label="Company record views"
            onKeyDown={tabKeys}
          >
            {availableViews.map(([key, title]) => (
              <button
                key={key}
                id={`tab-${key}`}
                role="tab"
                aria-controls={`panel-${key}`}
                aria-selected={view === key}
                tabIndex={view === key ? 0 : -1}
                className={`tab ${view === key ? "active" : ""} ${key === "publisher" ? "publisher-tab" : ""}`}
                onClick={() => changeView(key)}
              >
                {key === "publisher" ? "Release workspace" : title}
                {key === "profile" && <span>14</span>}
                {key === "publisher" && <span aria-hidden="true">↗</span>}
              </button>
            ))}
          </div>
          {loading && (
            <div className="loading-state" role="status">
              <span className="loading-pulse" />
              <p className="overline">READING THE SAVED COMPANY RECORD</p>
              <h2>Connecting the evidence.</h2>
              <p>Fetching the saved revision from EntityWiki.</p>
            </div>
          )}
          {error && view !== "publisher" && (
            <div className="error-state" role="alert">
              <p className="overline">RECORD UNAVAILABLE</p>
              <h2>The record could not be loaded.</h2>
              <p>{error}</p>
              <button className="button" onClick={() => void load()}>
                Try again <span aria-hidden="true">↻</span>
              </button>
            </div>
          )}
          {((!loading && !error && profile) ||
            (isAdmin && view === "publisher")) && (
            <div
              id={`panel-${view}`}
              className="view-panel"
              role="tabpanel"
              aria-labelledby={`tab-${view}`}
              tabIndex={0}
            >
              {view === "profile" && (
                <>
                  <div className="intro-grid">
                    <div className="intro-copy">
                      <p className="overline">01 / THE CONNECTED COMPANY</p>
                      <h2>
                        A company.
                        <br />A connected
                        <br />
                        <em>body of knowledge.</em>
                      </h2>
                      <p>
                        {string(
                          org.description ||
                            record.description ||
                            object(sectionMap.overview).content,
                          "Explore the company’s sourced claims and relationships. Every section carries its evidence state and research gaps.",
                        )}
                      </p>
                      <button
                        className="text-button"
                        onClick={() =>
                          inspect("Organization overview", {
                            organization: org,
                            section: sectionMap.overview,
                          })
                        }
                      >
                        Trace this description <Arrow />
                      </button>
                    </div>
                    <div className="graph-card">
                      <div className="graph-card-heading">
                        <div>
                          <p className="overline">RELATIONSHIP EXPLORER</p>
                          <h3>See the connections.</h3>
                        </div>
                        <button
                          className="graph-expand"
                          onClick={() => changeView("graph")}
                          aria-label="Open full entity graph"
                        >
                          ↗
                        </button>
                      </div>
                      <Graph
                        anchorId={string(record.entityId || org.id)}
                        anchorLabel={organizationName}
                        nodes={nodes}
                        selected={selectedNode}
                        select={(node) => {
                          selectNode(node);
                          changeView("graph");
                        }}
                        compact
                      />
                    </div>
                  </div>
                  <div className="coverage-strip">
                    <div>
                      <p className="overline">SECTION ASSESSMENT</p>
                      <strong>
                        {text(
                          coverage.assessed ||
                            coverage.assessedSections ||
                            Object.keys(sectionMap).length,
                        )}{" "}
                        <small>/ 14 assessed</small>
                      </strong>
                    </div>
                    <div>
                      <div className="coverage-line">
                        <i
                          style={{
                            width: `${Math.min(100, (Object.keys(sectionMap).length / 14) * 100)}%`,
                          }}
                        />
                      </div>
                      <p>
                        Assessment records what is known, missing, conflicted or
                        withheld.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => changeView("evidence")}
                    >
                      Inspect evidence <Arrow />
                    </button>
                  </div>
                  {sections.map(([key, title], index) => (
                    <section
                      key={key}
                      id={`section-${key}`}
                      className="company-section"
                    >
                      <SectionHeading
                        eyebrow={`${String(index + 1).padStart(2, "0")} / ${key.replace(/_/g, " ").toUpperCase()}`}
                        title={title}
                      >
                        <State value={status(object(sectionMap[key]))} />
                      </SectionHeading>
                      {(key === "services" && services.length) ||
                      (key === "products" && products.length) ? (
                        <div className="service-list">
                          {(key === "services" ? services : products).map(
                            (service, i) => (
                              <details
                                className="service-item"
                                key={string(service.id, String(i))}
                              >
                                <summary>
                                  <span className="overline muted">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  <span>{label(service)}</span>
                                  <span className="service-plus">+</span>
                                </summary>
                                <p>
                                  {string(
                                    service.description,
                                    key === "services"
                                      ? "Service observed in the source record. Inspect the claim for scope and provenance."
                                      : "Product or software observed in the source record. Inspect the claim for scope and provenance.",
                                  )}
                                </p>
                                {sourceButton(service, label(service))}
                              </details>
                            ),
                          )}
                        </div>
                      ) : key === "locations" && locations.length ? (
                        <div className="location-grid">
                          {locations.map((location, i) => (
                            <LocationCard
                              location={location}
                              index={i}
                              inspect={inspect}
                              key={string(location.id, String(i))}
                            />
                          ))}
                        </div>
                      ) : key === "external_links" &&
                        externalIdentities.length ? (
                        <>
                          <p className="section-copy muted">
                            External profile URLs retain their identity-matching
                            decisions. Candidate identities remain unverified
                            and are excluded from company sameAs markup.
                          </p>
                          <div className="concept-cloud">
                            {externalIdentities.map((identity, i) => (
                              <button
                                key={string(identity.id, String(i))}
                                title={string(identity.uri)}
                                onClick={() =>
                                  inspect(
                                    label(identity),
                                    identity,
                                    "EXTERNAL IDENTITY · " +
                                      status(identity).toUpperCase(),
                                  )
                                }
                              >
                                {label(identity)} · {status(identity)}
                                <Arrow />
                              </button>
                            ))}
                          </div>
                        </>
                      ) : key === "ontology" && concepts.length ? (
                        <div className="concept-cloud">
                          {concepts.slice(0, 24).map((concept, i) => (
                            <button
                              key={string(concept.id, String(i))}
                              onClick={() =>
                                inspect(
                                  label(concept),
                                  concept,
                                  "CONCEPT MAPPING",
                                )
                              }
                            >
                              {label(concept)}
                              <Arrow />
                            </button>
                          ))}
                          {concepts.length > 24 && (
                            <button onClick={() => changeView("mappings")}>
                              All {concepts.length} concepts ↗
                            </button>
                          )}
                        </div>
                      ) : key === "sources" && sources.length ? (
                        <div className="source-inline">
                          {sources.slice(0, 4).map((source, i) => (
                            <button
                              key={string(source.id, String(i))}
                              onClick={() =>
                                inspect(
                                  label(source, "Source record"),
                                  source,
                                  "SOURCE RECORD",
                                )
                              }
                            >
                              <span className="overline">
                                SOURCE {String(i + 1).padStart(2, "0")}
                              </span>
                              {label(source, string(source.url))}
                              <Arrow />
                            </button>
                          ))}
                          <button
                            className="text-button"
                            onClick={() => changeView("evidence")}
                          >
                            All evidence <Arrow />
                          </button>
                        </div>
                      ) : (
                        sectionContent(key)
                      )}
                      <div className="section-foot">
                        <p>
                          {string(
                            object(sectionMap[key]).nextAction ||
                              object(sectionMap[key]).reason ||
                              object(sectionMap[key]).statusReason,
                          )}
                        </p>
                        <button
                          className="text-button"
                          onClick={() =>
                            inspect(
                              title,
                              object(sectionMap[key]),
                              "SECTION ASSESSMENT",
                            )
                          }
                        >
                          Section record <Arrow />
                        </button>
                      </div>
                    </section>
                  ))}
                </>
              )}
              {view === "graph" && (
                <>
                  <SectionHeading
                    eyebrow="ENTITY RELATIONSHIPS"
                    title="Every node has a reason."
                  >
                    <span className="overline muted">
                      {nodes.length} SAVED RELATIONSHIPS
                    </span>
                  </SectionHeading>
                  <div
                    className="graph-controls"
                    aria-label="Filter relationships"
                  >
                    {["all", "service", "location", "concept", "person"].map(
                      (filter) => (
                        <button
                          key={filter}
                          className={`filter ${graphFilter === filter ? "active" : ""}`}
                          aria-pressed={graphFilter === filter}
                          onClick={() => {
                            setGraphFilter(filter);
                            setSelectedNode(
                              nodes.find(
                                (node) =>
                                  filter === "all" || node.kind === filter,
                              )?.id || "",
                            );
                          }}
                        >
                          {filter === "all"
                            ? "All relationships"
                            : human(`${filter}s`)}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="graph-workspace">
                    <Graph
                      anchorId={string(record.entityId || org.id)}
                      anchorLabel={organizationName}
                      nodes={nodes}
                      selected={activeNode?.id || ""}
                      select={selectNode}
                      filter={graphFilter}
                    />
                    <aside className="node-inspector" aria-live="polite">
                      {activeNode ? (
                        <>
                          <p className="overline">
                            {human(activeNode.kind)} NODE
                          </p>
                          <h3>{activeNode.label}</h3>
                          <State value={status(activeNode.data)} />
                          <p>
                            {string(
                              activeNode.data.description ||
                                activeNode.data.reason,
                              "A relationship represented in the saved company record. Open its evidence to inspect the source and decision.",
                            )}
                          </p>
                          <div className="inspector-relation">
                            {string(
                              object(activeNode.data.relationship).sourceLabel,
                              organizationName,
                            )}{" "}
                            → {activeNode.relation} → {human(activeNode.kind)}
                          </div>
                          <button
                            className="text-button"
                            onClick={() =>
                              inspect(
                                activeNode.label,
                                activeNode.data,
                                "RELATIONSHIP EVIDENCE",
                              )
                            }
                          >
                            Inspect relationship <Arrow />
                          </button>
                        </>
                      ) : (
                        <Empty>
                          No relationships are available in this revision.
                        </Empty>
                      )}
                    </aside>
                  </div>
                  <div className="annotation">
                    <span className="overline">
                      ACCESSIBLE RELATIONSHIP INDEX
                    </span>
                    <p>
                      Select a relationship to inspect its scope and evidence.
                      Concepts describe a topic or class; they do not establish
                      identity with the company.
                    </p>
                  </div>
                  <div className="relationship-list">
                    {nodes
                      .filter(
                        (node) =>
                          graphFilter === "all" || graphFilter === node.kind,
                      )
                      .map((node) => (
                        <button
                          key={node.id}
                          className={
                            activeNode?.id === node.id ? "selected" : ""
                          }
                          onClick={() => selectNode(node)}
                          aria-pressed={activeNode?.id === node.id}
                        >
                          <span className="overline">{human(node.kind)}</span>
                          <strong>{node.label}</strong>
                          <span>{node.relation}</span>
                          <Arrow />
                        </button>
                      ))}
                  </div>
                </>
              )}
              {view === "evidence" && (
                <>
                  <SectionHeading
                    eyebrow="PROVENANCE & CLAIMS"
                    title="Know where the knowledge came from."
                  />
                  <div className="evidence-summary">
                    <div className="evidence-number">
                      {String(sources.length).padStart(2, "0")}
                      <small>sources in this revision</small>
                    </div>
                    <div>
                      <p className="overline">SOURCE-BOUND KNOWLEDGE</p>
                      <h3>Evidence you can follow.</h3>
                      <p>
                        Each source retains its origin and collection date.
                        Publisher assertions and historical material remain
                        distinguishable from independent verification.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => inspect("Import provenance", provenance)}
                      >
                        Inspect import provenance <Arrow />
                      </button>
                    </div>
                  </div>
                  <SectionHeading
                    eyebrow="COMPANY PROFILE / V1"
                    title="Fourteen sections. Explicit assessments."
                  />
                  <div className="toolbar">
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        type="search"
                        placeholder="Find a section or research gap…"
                        aria-label="Search section assessments"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      value={sectionStatus}
                      onChange={(e) => setSectionStatus(e.target.value)}
                      aria-label="Filter section status"
                    >
                      <option value="all">All assessments</option>
                      {[
                        ...new Set(
                          sections.map(([key]) =>
                            status(object(sectionMap[key])),
                          ),
                        ),
                      ].map((value) => (
                        <option key={value} value={value}>
                          {human(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="table-scroll">
                    <table className="assessment-table">
                      <thead>
                        <tr>
                          <th>Section</th>
                          <th>Assessment</th>
                          <th>Evidence & next action</th>
                          <th>Inspect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSections.map(([key, title]) => {
                          const section = object(sectionMap[key]);
                          return (
                            <tr key={key}>
                              <td>
                                {title}
                                <code>{key}</code>
                              </td>
                              <td>
                                <State value={status(section)} />
                              </td>
                              <td>
                                {string(
                                  section.reason || section.statusReason,
                                  "No assessment reason recorded.",
                                )}
                                {section.nextAction ? (
                                  <p className="next-action">
                                    {text(section.nextAction)}
                                  </p>
                                ) : null}
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    inspect(
                                      title,
                                      section,
                                      "SECTION ASSESSMENT",
                                    )
                                  }
                                >
                                  Open <Arrow />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {!displayedSections.length && (
                          <tr>
                            <td colSpan={4}>
                              <Empty>No sections match this filter.</Empty>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <SectionHeading
                    eyebrow="CAPTURED SOURCE REGISTER"
                    title="Follow the source."
                  />
                  <div className="source-grid">
                    {sources.map((source, i) => (
                      <button
                        className="source-card"
                        key={string(source.id, String(i))}
                        onClick={() =>
                          inspect(
                            label(source, "Source record"),
                            source,
                            "SOURCE RECORD",
                          )
                        }
                      >
                        <span className="overline">
                          {string(
                            source.kind || source.type || source.publisherRole,
                            "SOURCE",
                          ).replace(/_/g, " ")}
                        </span>
                        <h3>
                          {label(source, string(source.url, "Source record"))}
                        </h3>
                        <p>{string(source.url)}</p>
                        <span className="source-card-foot">
                          {date(
                            source.fetchedAt ||
                              source.retrievedAt ||
                              source.retrievedDate,
                          )}
                          <Arrow />
                        </span>
                      </button>
                    ))}
                  </div>
                  {!sources.length && (
                    <Empty>
                      No source records are included in this revision.
                    </Empty>
                  )}
                  {!!conflicts.length && (
                    <>
                      <SectionHeading
                        eyebrow="RESEARCH GATES"
                        title="What differs stays visible."
                      />
                      <div className="conflict-grid">
                        {conflicts.map((conflict, i) => (
                          <button
                            key={string(conflict.id, String(i))}
                            className="conflict-card"
                            onClick={() =>
                              inspect(
                                label(conflict, "Source conflict"),
                                conflict,
                                "CONFLICT RECORD",
                              )
                            }
                          >
                            <State value={status(conflict)} />
                            <h3>
                              {label(
                                conflict,
                                string(conflict.field, "Source conflict"),
                              )}
                            </h3>
                            <p>
                              {string(
                                conflict.reason ||
                                  conflict.description ||
                                  conflict.summary,
                              )}
                            </p>
                            <span className="text-button">
                              Inspect alternatives <Arrow />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {view === "mappings" && (
                <>
                  <SectionHeading
                    eyebrow="SCHEMABRAINS → ENTITYWIKI"
                    title="Map meaning before publishing."
                  />
                  <div className="pipeline">
                    {[
                      [
                        "01",
                        "Collect",
                        "Saved source material and generation provenance.",
                      ],
                      [
                        "02",
                        "Resolve",
                        "Company, branches, offerings and concept identities.",
                      ],
                      [
                        "03",
                        "Validate",
                        "Typed relations, evidence and conflict decisions.",
                      ],
                      [
                        "04",
                        "Publish",
                        "One accepted revision across every destination.",
                      ],
                    ].map(([n, title, copy]) => (
                      <div key={n}>
                        <span className="overline">{n}</span>
                        <h3>{title}</h3>
                        <p>{copy}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mapping-pair">
                    <div className="mapping-callout">
                      <p className="overline">PRODUCT ONTOLOGY</p>
                      <h3>
                        A class for the offering.
                        <br />
                        <em>A reason for the match.</em>
                      </h3>
                      <p>
                        Product Ontology identifiers map to products or
                        services. Each match retains a class URI, relation,
                        evidence and decision.
                      </p>
                      <div className="code-token">
                        http://www.productontology.org/id/&#123;Wikipedia_title&#125;
                      </div>
                      <p className="section-note">
                        The /id/ URI identifies a class. The /doc/ URL is its
                        documentation. A concept mapping never makes the company
                        the same entity as a topic.
                      </p>
                    </div>
                    <div className="mapping-callout dark-callout">
                      <p className="overline">GOOGLE BUSINESS PROFILE / GMB</p>
                      <h3>
                        One company.
                        <br />
                        <em>Distinct branch identities.</em>
                      </h3>
                      <p>
                        Place IDs, Google listing resources, selected GBP
                        categories and Places types stay separate. Unresolved
                        matches stay explicit.
                      </p>
                      <dl className="mapping-status">
                        <div>
                          <dt>Branches represented</dt>
                          <dd>{locations.length}</dd>
                        </div>
                        <div>
                          <dt>With recorded Place IDs</dt>
                          <dd>
                            {
                              locations.filter(
                                (location) =>
                                  location.placeId ||
                                  object(location.google).placeId,
                              ).length
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>Company profile assessment</dt>
                          <dd>
                            {status(
                              object(sectionMap.google_business_profile),
                            ).replace(/_/g, " ")}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  <SectionHeading
                    eyebrow="PER-BRANCH IDENTITY"
                    title="Keep the location in the match."
                  />
                  <div className="location-grid">
                    {locations.map((location, i) => (
                      <LocationCard
                        location={location}
                        index={i}
                        inspect={inspect}
                        key={string(location.id, String(i))}
                        showMapping
                      />
                    ))}
                  </div>
                  {!locations.length && (
                    <Empty>No branch identities have been imported.</Empty>
                  )}
                  <SectionHeading
                    eyebrow="SEMANTIC CROSSWALK"
                    title="Concepts with context."
                  >
                    <span className="overline muted">
                      {concepts.length} CONCEPT RECORDS
                    </span>
                  </SectionHeading>
                  <div className="toolbar">
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find a concept or authority…"
                        aria-label="Search concept mappings"
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="mapping-table">
                      <thead>
                        <tr>
                          <th>Concept / scope</th>
                          <th>Authority mapping</th>
                          <th>Decision</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {concepts
                          .filter((concept) =>
                            JSON.stringify(concept)
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                          )
                          .map((concept, i) => {
                            const urls = object(concept.urls);
                            const ontology = object(concept.productOntology);
                            return (
                              <tr key={string(concept.id, String(i))}>
                                <td>
                                  <button
                                    className="table-name"
                                    onClick={() =>
                                      inspect(
                                        label(concept),
                                        concept,
                                        "CONCEPT MAPPING",
                                      )
                                    }
                                  >
                                    {label(concept)}
                                  </button>
                                  <small>
                                    {[
                                      human(
                                        string(concept.authority, "authority"),
                                      ),
                                      string(concept.relation || concept.scope),
                                      string(concept.subjectId),
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                </td>
                                <td>
                                  {[
                                    concept.uri,
                                    concept.productOntologyUrl,
                                    concept.productOntologyUri,
                                    concept.classUri,
                                    ontology.uri,
                                    urls.productOntologyUrl,
                                    concept.wikipediaUrl,
                                    urls.wikipediaUrl,
                                    concept.wikidataUrl,
                                    urls.wikidataUrl,
                                    concept.dbpediaUrl,
                                    urls.dbpediaUrl,
                                  ]
                                    .filter(
                                      (v, index, list) =>
                                        v && list.indexOf(v) === index,
                                    )
                                    .map((value, index) => (
                                      <a
                                        key={index}
                                        href={safeUrl(value)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        {text(value)} ↗
                                      </a>
                                    ))}
                                </td>
                                <td>
                                  <State value={status(concept)} />
                                </td>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      inspect(
                                        label(concept),
                                        concept,
                                        "MAPPING EVIDENCE",
                                      )
                                    }
                                  >
                                    Inspect <Arrow />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        {!concepts.length && (
                          <tr>
                            <td colSpan={4}>
                              <Empty>
                                No concept mappings have been imported.
                              </Empty>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {view === "json" && (
                <>
                  <SectionHeading
                    eyebrow="STRUCTURED EXPORT"
                    title="The same record. Machine readable."
                  >
                    <div className="button-group">
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              JSON.stringify(profile?.jsonld, null, 2),
                            );
                            setToast("JSON-LD copied.");
                          } catch {
                            setToast(
                              "Clipboard unavailable. Use the download link to save the export.",
                            );
                          }
                        }}
                        disabled={!profile?.jsonld}
                      >
                        Copy JSON-LD
                      </button>
                      <a
                        className="button"
                        href={`${recordUrl}/schema.jsonld`}
                        download="maxplaces-marketing.jsonld"
                      >
                        Download <Arrow />
                      </a>
                    </div>
                  </SectionHeading>
                  <div className="json-layout">
                    <div className="code-panel">
                      <div className="code-heading overline">
                        <span>MAXPLACES-MARKETING.JSONLD</span>
                        <span>APPLICATION/LD+JSON</span>
                      </div>
                      <pre tabIndex={0}>
                        {profile?.jsonld
                          ? JSON.stringify(profile?.jsonld, null, 2)
                          : "No schema export is available for this revision."}
                      </pre>
                    </div>
                    <aside className="export-notes">
                      <p className="overline">EXPORT PROVENANCE</p>
                      <h3>
                        Bound to
                        <br />
                        <em>the evidence.</em>
                      </h3>
                      <p>
                        This JSON-LD is returned by the record API. Its
                        identifiers, offerings and semantic mappings follow the
                        same saved revision as the profile.
                      </p>
                      <div className="export-item">
                        <span className="overline">RECORD REVISION</span>
                        <p>{text(record.revision) || "Not recorded"}</p>
                      </div>
                      <div className="export-item">
                        <span className="overline">SOURCE GENERATION</span>
                        <p>
                          {text(
                            provenance.generationId || provenance.generationID,
                          ) || "No SchemaBrains generation linked"}
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          inspect("Export provenance", {
                            provenance,
                            publication,
                          })
                        }
                      >
                        Inspect provenance <Arrow />
                      </button>
                    </aside>
                  </div>
                </>
              )}
              {isAdmin && view === "publisher" && (
                <Publisher
                  record={record}
                  webRelease={webRelease}
                  refresh={load}
                  inspect={inspect}
                />
              )}
            </div>
          )}
          <footer className="main-footer">
            <span className="overline">
              ENTITYWIKI / CONNECTED BY SCHEMABRAINS
            </span>
            <span>Built around evidence.</span>
            <a href="https://entitywiki.com/">Platform ↗</a>
            <a className="text-button" href="#main">
              Back to top ↑
            </a>
          </footer>
        </main>
      </div>
      {inspector && (
        <EvidenceDrawer
          inspector={inspector}
          close={() => setInspector(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

function LocationCard({
  location,
  index,
  inspect,
  showMapping = false,
}: {
  location: Item;
  index: number;
  inspect: (title: string, data: unknown, subtitle?: string) => void;
  showMapping?: boolean;
}) {
  const address = object(location.address);
  const google = object(
    location.google || location.googleBusinessProfile || location.gmb,
  );
  const addressLine =
    typeof location.address === "string"
      ? location.address
      : [
          address.streetAddress,
          address.addressLocality,
          address.addressRegion,
          address.postalCode,
          address.addressCountry,
        ]
          .map(text)
          .filter(Boolean)
          .join(", ");
  const placeId = string(location.placeId || google.placeId);
  const mapUrl =
    safeUrl(location.mapUrl || google.mapsUrl) ||
    (placeId
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label(location))}&query_place_id=${encodeURIComponent(placeId)}`
      : undefined);
  return (
    <article className="location-card">
      <p className="overline">BRANCH {String(index + 1).padStart(2, "0")}</p>
      <h3>{label(location, "Business location")}</h3>
      <p className="location-address">
        {addressLine ||
          "Street address has not been accepted for this location."}
      </p>
      {array(location.unresolvedFields).length > 0 && (
        <p className="location-warning">
          Unresolved: {array(location.unresolvedFields).map(text).join(", ")}
        </p>
      )}
      <dl>
        <div>
          <dt>PLACE ID</dt>
          <dd>{placeId || "Unresolved"}</dd>
        </div>
        <div>
          <dt>GOOGLE CATEGORY</dt>
          <dd>
            {text(
              location.primaryCategory ||
                google.primaryCategoryId ||
                google.primaryCategory ||
                google.category,
            ) || "Not verified"}
          </dd>
        </div>
        {showMapping && (
          <>
            <div>
              <dt>GBP RESOURCE</dt>
              <dd>
                {text(
                  google.gbpLocationResource ||
                    google.locationResource ||
                    google.locationName,
                ) || "Not linked"}
              </dd>
            </div>
            <div>
              <dt>IDENTITY STATE</dt>
              <dd>
                {text(
                  google.state || google.status || location.googleMappingStatus,
                ) || "Unresolved"}
              </dd>
            </div>
          </>
        )}
      </dl>
      <div className="location-status">
        <State value={status(location)} />
        <button
          className="text-button"
          onClick={() =>
            inspect(label(location), location, "BRANCH IDENTITY & EVIDENCE")
          }
        >
          Inspect branch <Arrow />
        </button>
      </div>
      {mapUrl && (
        <a
          className="map-link text-button"
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source map <Arrow />
        </a>
      )}
    </article>
  );
}

function Publisher({
  record,
  webRelease,
  refresh,
  inspect,
}: {
  record: Item;
  webRelease: Item;
  refresh: () => Promise<void>;
  inspect: (title: string, data: unknown, subtitle?: string) => void;
}) {
  const [connections, setConnections] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [result, setResult] = useState<Item | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [approvedRecordId, setApprovedRecordId] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const checkConnections = useCallback(async () => {
    try {
      setConnections(await request("/api/connections"));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Connection status is unavailable.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    void request("/api/connections")
      .then((data) => {
        if (!active) return;
        setConnections(data);
        try {
          setPendingSubmission(!!localStorage.getItem(scanRequestStorageKey));
          const saved = localStorage.getItem(scanOperationStorageKey);
          if (saved)
            setPendingRequestId(string(object(JSON.parse(saved)).requestId));
        } catch {
          /* Storage is required before submitting a new scan, not before reading a record. */
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Connection status is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: string, path: string, body: Item) => {
    setBusy(action);
    setError("");
    setResult(null);
    try {
      const createsGeneration =
        path === "/api/import" && !body.mode && !body.generationId;
      let idempotencyKey = "";
      if (createsGeneration) {
        try {
          idempotencyKey =
            localStorage.getItem(scanRequestStorageKey) || crypto.randomUUID();
          localStorage.setItem(scanRequestStorageKey, idempotencyKey);
          setPendingSubmission(true);
        } catch {
          throw new Error(
            "Enable browser storage before starting a scan so an uncertain response can reuse its saved request key.",
          );
        }
      }
      const response = await request(
        path,
        body,
        idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      );
      setResult(response);
      const requestId = string(response.requestId);
      const state = string(response.state || response.status);
      if (requestId) {
        try {
          localStorage.setItem(
            scanOperationStorageKey,
            JSON.stringify({
              requestId,
              state,
              savedAt: new Date().toISOString(),
            }),
          );
          if (createsGeneration) localStorage.removeItem(scanRequestStorageKey);
          setPendingSubmission(false);
        } catch {
          throw new Error(
            "The server accepted the scan, but this browser could not save its operation. An explicit retry will reuse the saved submission key.",
          );
        }
      }
      if (requestId && ["queued", "running", "submitting"].includes(state))
        setPendingRequestId(requestId);
      else if (action === "poll" || requestId) {
        setPendingRequestId("");
        try {
          localStorage.removeItem(scanOperationStorageKey);
        } catch {
          /* The operation response remains visible. */
        }
      }
      if (
        action === "import" ||
        action === "release" ||
        (action === "poll" && state === "completed")
      ) {
        if (action === "release") setApprovedRecordId("");
        await refresh();
      }
      await checkConnections();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The operation did not complete.",
      );
    } finally {
      setBusy("");
    }
  };
  const connectors: Item[] = connections
    ? Object.entries(connections)
        .filter(
          ([id, value]) =>
            !["operations", "wiki"].includes(id) &&
            value &&
            typeof value === "object",
        )
        .map(([id, value]) => ({
          id,
          name: id === "schemaBrains" ? "SchemaBrains" : human(id),
          ...object(value),
        }))
    : [];
  const recordId = string(record.id);
  const released = !!recordId && webRelease.recordId === recordId && webRelease.projectionCurrent === true;
  const coverage = object(record.coverage);
  const provenance = object(record.provenance);
  const responseImport = object(result?.import);
  const responseSummary = Object.fromEntries(
    [
      "message",
      "apiVersion",
      "state",
      "status",
      "runId",
      "requestId",
      "generationId",
      "recordId",
      "replayed",
      "coverage",
      "release",
      "webRelease",
      "error",
    ]
      .filter((key) => result?.[key] !== undefined)
      .map((key) => [key, result?.[key]]),
  );
  if (responseImport.recordId)
    responseSummary.acceptedImport = {
      recordId: responseImport.recordId,
      replayed: responseImport.replayed,
      coverage: responseImport.coverage,
    };
  return (
    <>
      <SectionHeading
        eyebrow="PRIVATE EDITORIAL WORKSPACE"
        title="Collect. Review. Release."
      >
        <button
          className="text-button"
          onClick={() => void checkConnections()}
          disabled={!!busy}
        >
          Refresh connections <span aria-hidden="true">↻</span>
        </button>
      </SectionHeading>
      <p className="publisher-intro">
        Collect and inspect the latest saved company revision here. An explicit
        registry release makes that exact revision available in the public
        dossier, graph and structured export.
      </p>
      {error && (
        <div className="operation-message error-message" role="alert">
          <strong>Action could not complete</strong>
          <p>{error}</p>
        </div>
      )}
      {pendingRequestId && (
        <div className="pending-generation">
          <div>
            <p className="overline">SCHEMABRAINS GENERATION IN PROGRESS</p>
            <p>Request {pendingRequestId}</p>
          </div>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() =>
              void run("poll", "/api/generation/poll", {
                requestId: pendingRequestId,
              })
            }
          >
            {busy === "poll" ? "Checking…" : "Check generation progress"}
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      )}
      <div className="connection-grid">
        {connectors.map((connection, i) => (
          <div
            className="connection-card"
            key={string(connection.id, String(i))}
          >
            <p className="overline">SERVER CONNECTION</p>
            <h3>{label(connection)}</h3>
            <State
              value={string(
                connection.status,
                connection.configured === true
                  ? "configured"
                  : connection.configured === false
                    ? "credential_required"
                    : "unknown",
              )}
            />
            <p>
              {string(
                connection.reason || connection.message,
                "Inspect this connection for its current capabilities.",
              )}
            </p>
            <button
              className="text-button"
              onClick={() =>
                inspect(label(connection), connection, "CONNECTION CAPABILITY")
              }
            >
              Capability details <Arrow />
            </button>
            {connection.id === "schemaBrains" && (
              <button
                className="text-button connection-check"
                disabled={!!busy}
                onClick={() =>
                  void run("connection", "/api/connections/check", {})
                }
              >
                {busy === "connection" ? "Checking…" : "Check live connection"}
                <Arrow />
              </button>
            )}
          </div>
        ))}
        {!connections && (
          <div className="connection-card">
            <p className="overline">CHECKING SERVER ACCESS</p>
            <p>Reading the authenticated workspace capabilities.</p>
          </div>
        )}
      </div>
      <div className="workflow-grid">
        <section className="workflow-card">
          <span className="step-number">01</span>
          <p className="overline">SCHEMABRAINS INPUT</p>
          <h3>Bring in the evidence.</h3>
          <p>
            Import an owned generation, or start a bounded scan of the pilot
            company. Collection creates a saved revision for editorial review.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                "import",
                "/api/import",
                generationId.trim()
                  ? { generationId: generationId.trim() }
                  : {},
              );
            }}
          >
            <label>
              Pilot company URL
              <input type="url" readOnly value="https://www.maxplaces.com/" />
            </label>
            <label>
              Generation ID <span className="muted">(optional)</span>
              <input
                value={generationId}
                onChange={(event) => setGenerationId(event.target.value)}
                placeholder="Import an existing owned result"
                autoComplete="off"
              />
            </label>
            {pendingSubmission && (
              <p className="submission-note">
                An earlier submission is awaiting acknowledgement. Retry reuses
                its saved request key.
              </p>
            )}
            <button
              className="button"
              disabled={
                !!busy ||
                !connections ||
                (!!pendingRequestId && !generationId.trim())
              }
            >
              {busy === "import"
                ? "Importing…"
                : generationId.trim()
                  ? "Import saved generation"
                  : pendingSubmission
                    ? "Retry saved scan request"
                    : "Start SchemaBrains scan"}
              <Arrow />
            </button>
          </form>
          <details className="pilot-import-option">
            <summary>Initialize from the accepted pilot snapshot</summary>
            <p>
              Restore the preserved accepted MAXPlaces record and its evidence
              to this workspace. Public release remains a separate editorial
              action.
            </p>
            <button
              className="text-button"
              disabled={!!busy || !connections}
              onClick={() =>
                void run("import", "/api/import", { mode: "restore_pilot" })
              }
            >
              Restore accepted pilot snapshot <Arrow />
            </button>
          </details>
        </section>
        <section className="workflow-card release-card">
          <span className="step-number">02</span>
          <p className="overline">PUBLIC REGISTRY RELEASE</p>
          <h3>Release the reviewed revision.</h3>
          <p>
            The public dossier stays on its released record while newer
            collection results are reviewed in this workspace.
          </p>
          <div className="workflow-record">
            <span className="overline">LATEST ACCEPTED RECORD</span>
            <strong>
              {string(object(record.org).name, "MAXPlaces Marketing")}
            </strong>
            <span>
              {recordId
                ? `Revision ${text(record.revision)} · ${recordId}`
                : "No accepted record yet"}
            </span>
            <State
              value={
                released
                  ? "released"
                  : recordId
                    ? "awaiting_release"
                    : "not_imported"
              }
            />
          </div>
          {!!recordId && (
            <div className="release-coverage">
              <span>
                <strong>{text(coverage.assessedSections)}</strong> sections
                assessed
              </span>
              <span>
                <strong>{text(coverage.sourcedSections)}</strong> sourced
                sections
              </span>
              <span>
                <strong>{text(coverage.supportedClaims)}</strong> supported
                claims
              </span>
              <span>
                <strong>{text(coverage.unresolvedConflicts)}</strong> open
                conflicts
              </span>
            </div>
          )}
          <button
            className="text-button"
            onClick={() =>
              inspect(
                "Record proposed for registry release",
                {
                  recordId,
                  revision: record.revision,
                  sections: record.sections,
                  coverage,
                  provenance,
                },
                "RELEASE REVIEW",
              )
            }
            disabled={!recordId}
          >
            Inspect this revision <Arrow />
          </button>
          <label className="release-reason">
            Editorial release note
            <textarea
              rows={3}
              maxLength={1000}
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
              placeholder="Why is this revision ready for the registry?"
            />
          </label>
          <label className="approval-check">
            <input
              type="checkbox"
              checked={!!recordId && approvedRecordId === recordId}
              onChange={(event) =>
                setApprovedRecordId(event.target.checked ? recordId : "")
              }
              disabled={!recordId || released}
            />
            <span>
              I reviewed this saved revision, its evidence and its open research
              states, and approve its public registry release.
            </span>
          </label>
          <button
            className="button"
            disabled={
              !!busy || !recordId || released || approvedRecordId !== recordId
            }
            onClick={() =>
              void run("release", "/api/releases", {
                recordId,
                expectedPreviousReleaseId: webRelease.id || null,
                reason:
                  releaseReason.trim() ||
                  "Reviewed company record released from the editorial workspace.",
              })
            }
          >
            {busy === "release"
              ? "Releasing…"
              : released
                ? "This revision is released"
                : "Release this revision"}
            <Arrow />
          </button>
        </section>
      </div>
      {result && (
        <section className="operation-result" role="status">
          <SectionHeading
            eyebrow="SERVER RESPONSE"
            title={string(result.message, "Operation response received.")}
          />
          <Details data={responseSummary} />
          <button
            className="text-button"
            onClick={() =>
              inspect("Complete server response", result, "OPERATION EVIDENCE")
            }
          >
            Inspect complete response <Arrow />
          </button>
        </section>
      )}
      <div className="publication-receipt">
        <p className="overline">CURRENT REGISTRY RELEASE</p>
        <a className="text-button" href="/MAXPlaces_Marketing">
          Open the released MAXPlaces dossier <Arrow />
        </a>
        {Object.keys(webRelease).length ? (
          <>
            <Details
              data={Object.fromEntries(
                ["id", "recordId", "sequence", "releasedAt", "reason", "digest"]
                  .filter((key) => webRelease[key] !== undefined)
                  .map((key) => [key, webRelease[key]]),
              )}
            />
            <button
              className="text-button"
              onClick={() =>
                inspect("Registry release receipt", webRelease, "RELEASE AUDIT")
              }
            >
              Inspect complete release <Arrow />
            </button>
          </>
        ) : (
          <p>
            No public registry release is recorded. Accepted imports remain
            private until release.
          </p>
        )}
        <p className="registry-release-note">
          Source generation: {string(provenance.generationId, "Not linked")}.
          Registry releases are independent of the preserved MediaWiki article
          history.
        </p>
      </div>
    </>
  );
}
