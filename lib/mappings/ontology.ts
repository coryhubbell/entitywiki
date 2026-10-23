/** Relation-aware derivative of SchemaBrains src/utils/url-derivation.ts.
 * URL derivation is a candidate generator. Transport success never approves semantics.
 */
export interface ConceptUrls {
  wikipediaTitle: string;
  wikipediaUrl: string;
  productOntologyClassUri: string;
  productOntologyDocumentUrl: string;
  productOntologyTurtleUrl: string;
  dbpediaResourceUri: string;
  dbpediaDocumentUrl: string;
}

export function deriveConceptUrls(input: string): ConceptUrls | null {
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'en.wikipedia.org' || url.username || url.password || url.port || !url.pathname.startsWith('/wiki/')) return null;
  let title: string;
  try { title = decodeURIComponent(url.pathname.slice(6)).replace(/ /g, '_'); } catch { return null; }
  // Article identity must be supplied. Never invent an article title from an arbitrary term.
  if (!title || /[\u0000-\u001f<>/?#\\]/u.test(title) || /^(?:Category|Template|File|Help|Special|Talk|User|Wikipedia|Portal|Draft|Module|MediaWiki):/i.test(title)) return null;
  const slug = encodeURIComponent(title).replace(/%3A/gi, ':');
  return {
    wikipediaTitle: title,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${slug}`,
    productOntologyClassUri: `http://www.productontology.org/id/${slug}`,
    productOntologyDocumentUrl: `http://www.productontology.org/doc/${slug}`,
    productOntologyTurtleUrl: `http://www.productontology.org/doc/${slug}.ttl`,
    dbpediaResourceUri: `https://dbpedia.org/resource/${slug}`,
    dbpediaDocumentUrl: `https://dbpedia.org/page/${slug}`,
  };
}

export interface OntologyAvailability {
  checkedAt: string;
  requestedUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  status: 'class_declared' | 'unavailable' | 'not_declared' | 'invalid_identity';
  canonicalClassUri?: string;
  sha256?: string;
  error?: string;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Deliberately limited to Product Ontology's documented Turtle serialization. */
export function declaresExpectedProductOntologyClass(turtle: string, classUri: string): boolean {
  const owlPrefix = /^@prefix\s+owl:\s*<http:\/\/www\.w3\.org\/2002\/07\/owl#>\s*\./m.test(turtle);
  if (!owlPrefix) return false;
  return new RegExp(`^<${escapeRegExp(classUri)}>\\s+a\\s+owl:Class\\s*[;.]`, 'm').test(turtle);
}

export async function verifyProductOntologyClass(wikipediaUrl: string, fetcher: typeof fetch = fetch): Promise<OntologyAvailability> {
  const urls = deriveConceptUrls(wikipediaUrl);
  const checkedAt = new Date().toISOString();
  if (!urls) return { checkedAt, requestedUrl: wikipediaUrl, status: 'invalid_identity' };
  const base = { checkedAt, requestedUrl: urls.productOntologyTurtleUrl, canonicalClassUri: urls.productOntologyClassUri };
  try {
    const response = await fetcher(urls.productOntologyTurtleUrl, { headers: { Accept: 'text/turtle' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { ...base, status: 'unavailable', httpStatus: response.status };
    if (Number(response.headers.get('content-length') ?? 0) > 1_000_000) return { ...base, status: 'unavailable', httpStatus: response.status, error: 'Ontology response exceeds size limit' };
    const body = await response.text();
    if (body.length > 1_000_000) return { ...base, status: 'unavailable', httpStatus: response.status, error: 'Ontology response exceeds size limit' };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...base, finalUrl: response.url || base.requestedUrl, httpStatus: response.status, sha256, status: declaresExpectedProductOntologyClass(body, urls.productOntologyClassUri) ? 'class_declared' : 'not_declared' };
  } catch {
    return { ...base, status: 'unavailable', error: 'Ontology transport failed; semantic decision unchanged' };
  }
}

export interface OfferingClassMapping {
  subjectId: string;
  subjectKind: 'organization' | 'location' | 'service' | 'product' | 'concept';
  relation: 'additionalType' | 'about' | 'sameAs';
  targetClassUri: string;
  wikipediaUrl: string;
  semanticDecision: 'accepted' | 'candidate' | 'rejected';
  evidenceIds: string[];
  rationale: string;
  reviewedBy: string | null;
  availability: OntologyAvailability;
}

export function additionalTypeExportDecision(mapping: OfferingClassMapping): { accepted: boolean; reasons: string[] } {
  const urls = deriveConceptUrls(mapping.wikipediaUrl);
  const reasons: string[] = [];
  if (!['service', 'product'].includes(mapping.subjectKind)) reasons.push('Product Ontology types require a service or product subject');
  if (mapping.relation !== 'additionalType') reasons.push('A type assignment must use additionalType');
  if (mapping.semanticDecision !== 'accepted') reasons.push('Semantic review has not accepted this mapping');
  if (!mapping.evidenceIds.length || !mapping.rationale.trim() || !mapping.reviewedBy?.trim()) reasons.push('Source evidence, explicit rationale, and reviewer are required');
  if (!urls || urls.productOntologyClassUri !== mapping.targetClassUri) reasons.push('Class URI must derive from the supplied English Wikipedia article identity');
  if (mapping.availability.status !== 'class_declared' || mapping.availability.canonicalClassUri !== mapping.targetClassUri) reasons.push('The exact class declaration has not been verified');
  return { accepted: reasons.length === 0, reasons };
}
