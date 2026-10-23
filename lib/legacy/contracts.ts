/** Lossless staging transport for a verified public archive, never a full SQL/accounts backup. */
export interface LegacyDescriptor {
  format: "entitywiki.legacy-capture/1";
  sourceOrigin: "https://entitywiki.org";
  sourceWikiId: string;
  archiveManifestSha256: string;
  transferDigest: string;
  capturedAt: string;
  captureStartedAt: string;
  expected: { pages: number; revisions: number; routes: number };
  namespaces: { id: number; name: string; canonical?: string; aliases?: string[] }[];
  accessPolicy: "operator_only";
  sourcePermissionScope: "unauthenticated_public_capture_only";
}
export interface LegacyPageTransfer {
  kind: "page"; pageId: number; namespace: number; title: string; classification: string;
  latestCapturedRevisionId: number;
  observedLatestRevisionId: number | null;
  /** All original captured page fields except revisions; includes dependencies and protection observations. */
  raw: Record<string, unknown>;
}
export interface LegacyRevisionTransfer {
  kind: "revision"; pageId: number; revisionId: number;
  /** Original immutable revision metadata and all slots; hidden/suppressed flags must still be respected. */
  raw: Record<string, unknown>;
}
export interface LegacyRouteTransfer {
  kind: "route"; pageId: number; revisionId: number | null; url: string; routeKind: string;
  raw: Record<string, unknown>;
}
export type LegacyTransferRecord = LegacyPageTransfer | LegacyRevisionTransfer | LegacyRouteTransfer;
export interface LegacyImportReceipt {
  snapshotId: string; state: "loading" | "ready"; replayed?: boolean;
  counts: { pages: number; revisions: number; routes: number };
}
export interface LegacyPageView {
  snapshotId: string; sourceKey: string; stablePageId: string; pageId: number; namespace: number;
  title: string; classification: string; latestCapturedRevisionId: number; observedLatestRevisionId: number | null;
  raw: Record<string, unknown>;
}
export interface LegacyRevisionView {
  snapshotId: string; pageId: number; revisionId: number; raw: Record<string, unknown>;
}
export interface LegacySnapshotView {
  snapshotId: string; sourceKey: string; state: "loading" | "ready"; descriptor: LegacyDescriptor;
}
export interface LegacyRouteView extends LegacyRouteTransfer { snapshotId: string; }
export interface LegacyCounts { pages: number; revisions: number; routes: number; }
export interface LegacyPageQuery { namespace?: number; search?: string; limit?: number; offset?: number; }
export interface LegacyHistoryQuery { limit?: number; offset?: number; }
export interface LegacyStore {
  begin(descriptor: LegacyDescriptor): Promise<LegacyImportReceipt>;
  ingest(snapshotId: string, records: LegacyTransferRecord[]): Promise<LegacyImportReceipt>;
  finalize(snapshotId: string): Promise<LegacyImportReceipt>;
  latestReady(): Promise<LegacySnapshotView | null>;
  snapshot(snapshotId: string): Promise<LegacySnapshotView | null>;
  listPages(snapshotId: string, query?: LegacyPageQuery): Promise<LegacyPageView[]>;
  pageById(snapshotId: string, pageId: number): Promise<LegacyPageView | null>;
  pageByTitle(snapshotId: string, title: string): Promise<LegacyPageView | null>;
  revisionById(snapshotId: string, revisionId: number): Promise<LegacyRevisionView | null>;
  history(snapshotId: string, pageId: number, query?: LegacyHistoryQuery): Promise<LegacyRevisionView[]>;
  resolveRoute(snapshotId: string, url: string): Promise<LegacyRouteView | null>;
  stats(snapshotId: string): Promise<LegacyCounts>;
}
