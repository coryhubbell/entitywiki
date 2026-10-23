/** Production release contract. The earlier templates/*.example.json remain design-only. */
export const SECTION_TITLES = {
  overview: "Overview", company_identity: "Company identity", history: "History", team: "Team",
  services: "Services", products: "Products and offers", framework: "Framework and methodology",
  locations: "Locations", service_areas: "Service areas", google_business_profile: "Google Business Profile mapping",
  external_links: "External links", ontology: "Ontology", gallery: "Gallery", sources: "Sources and record history",
} as const;
export type SectionKey = keyof typeof SECTION_TITLES;
export type SectionStatus = "sourced" | "needs_research" | "conflicted" | "not_applicable" | "withheld";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Section { key: SectionKey; title: string; status: SectionStatus; reason: string; content: string; claimIds: string[]; nextAction?: string }
export interface Evidence {
  id: string; url: string; finalUrl: string; title: string; kind: "first_party" | "schemabrains" | "legacy_wiki" | "authority" | "google_observation";
  retrievedAt: string; sha256: string; excerpt: string; locator?: string;
  destinations: { public: boolean; wiki: boolean; jsonld: boolean }; attribution: string;
}
export interface Entity { id: string; kind: "organization" | "branch" | "service" | "product" | "person" | "concept"; name: string; parentId?: string; sourceIds: string[] }
export interface Claim {
  id: string; subjectId: string; predicate: string; value: JsonValue; section: SectionKey; sourceIds: string[];
  state: "supported" | "conflicted" | "candidate" | "withheld"; selected: boolean; reason: string; locator?: string;
}
export interface Offering { id: string; name: string; kind: "Service" | "Product" | "SoftwareApplication"; url?: string; description?: string; sourceIds: string[]; additionalType: string[] }
export interface Branch { id: string; name: string; address: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string }; telephone?: string; sourceIds: string[]; unresolvedFields: string[] }
export interface OntologyMapping {
  id: string; subjectId: string; label: string; authority: "product_ontology" | "wikidata" | "wikipedia" | "dbpedia" | "publisher";
  uri: string; relation: "offering_type" | "topic" | "exact_identity"; state: "accepted" | "candidate" | "unavailable" | "rejected";
  sourceIds: string[]; reason: string; checkedAt?: string; wikipediaTitle?: string;
}
export interface GoogleMapping {
  branchId: string; state: "unresolved" | "observed" | "verified"; name: string; placeId: string | null;
  gbpLocationResource: string | null; mapsCid: string | null; knowledgeGraphMid: string | null;
  primaryCategoryId: string | null; additionalCategoryIds: string[]; placesTypes: string[];
  proposedCategories: { label: string; state: "proposed"; reason: string }[]; mapsUrl?: string; sourceIds: string[]; reason: string;
}
export interface Conflict { id: string; subjectId: string; predicate: string; claimIds: string[]; values: JsonValue[]; state: "open"; reason: string }
export interface CompanyRecord {
  contractVersion: "entitywiki.company/1"; id: string; entityId: string; slug: string; revision: number; createdAt: string; acceptedAt: string;
  status: "accepted"; org: { id: string; name: string; legalName?: string; url: string; description?: string };
  sections: Record<SectionKey, Section>; entities: Entity[]; claims: Claim[]; sources: Evidence[]; services: Offering[];
  locations: Branch[]; concepts: OntologyMapping[]; google: GoogleMapping[]; conflicts: Conflict[];
  coverage: { assessedSections: number; sourcedSections: number; supportedClaims: number; unresolvedConflicts: number; verifiedGoogleLocations: number; acceptedOntologyMappings: number };
  provenance: { generationId: string | null; sourceUrl: string; receiptSha256: string | null; integrity: Record<string, boolean | null>; limitations: string[]; importDigest: string; mappingVersion: string; acquisition: string };
  wiki: { pageId: number; title: string; startingRevision: number };
}
export interface WebRelease {id:string;entityId:string;recordId:string;sequence:number;previousReleaseId:string|null;actor:string;reason:string;digest:string;releasedAt:string}
export interface Graph { nodes: { id: string; label: string; type: Entity["kind"]; sourceIds: string[] }[]; edges: { id: string; source: string; target: string; label: string; type: string; claimIds: string[] }[] }
export interface SavedGeneration {
  generationId: string; sourceUrl: string | null; createdAt: string; revision: number; rootId: string;
  receiptStatus: string; schema: object; glossaryHTML?: string | null; validation?: unknown; receipt?: unknown;
  receiptSha256: string | null; integrity: { receiptVerified: boolean | null; sidecarsVerified: boolean | null; glossaryHTMLVerified: boolean | null; referenceProfileVerified?: null };
  generationSource?: string | null; options?: Record<string, unknown> | null; industry?: string | null;
  zoneProvenance?: unknown; availability?: Record<string, unknown>; knowledgeStats?: unknown;
  limitations?: string[];
}
export interface CollectedPage { url: string; finalUrl: string; title: string; text: string; jsonld: unknown[]; sha256: string; retrievedAt: string }
export interface WikiPage { pageId: number; title: string; revision: number; timestamp: string; currentTimestamp: string; text: string; missing: boolean }
export type PublicationState = "preview" | "publishing" | "published" | "noop" | "conflict" | "reconcile" | "failed";
export interface PublicationPlan {
  planId: string; recordId: string; entityId: string; title: string; pageId: number; status: PublicationState;
  expectedRevision: number; before: string; after: string; wikitext: string; beforeDigest: string; afterDigest: string;
  managedDigest: string; previousManagedDigest: string | null; createdAt: string; newRevision?: number; error?: string;
  diffSummary: string; startTimestamp: string; baseTimestamp: string;
  receipt?: { channel: "service_bot" | "supervised_browser"; revision: number; readbackDigest: string; verifiedAt: string; reconciled: boolean };
}
export interface GenerationOperation { requestId: string; generationId: string | null; state: "queued" | "running" | "completed" | "failed" | "interrupted"; resultAvailable?: boolean; error?: { code: string; message: string; status: number } }
export interface PilotMappingSupplement {
  version: string; sourceManifestSha256: string;
  google: {branchLocality:string;placeId:string;mapsUrl:string;primaryCategoryId:null;state:"verified";sourceUrl:string;excerpt:string;checkedAt:string;reason:string;proposedCategories?:{label:string;rationale:string}[]}[];
  ontology: {offeringName:string;wikipediaTitle:string;uri:string;relation:"offering_type";sourceUrl:string;excerpt:string;checkedAt:string;reason:string;state:"accepted";authorityUrl:string;authoritySha256:string;firstPartySha256:string;authorityClassDeclared:boolean}[];
}
