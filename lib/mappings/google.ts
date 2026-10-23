/** Google observations stay transient. Only Place IDs and our independent-source
 * match decision are durable; Places primaryType is never a selected GBP category.
 */
export interface IndependentBranchFacts {
  branchId: string;
  companyName: string;
  nameAliases?: string[];
  streetAddress: string;
  telephone: string;
  website: string;
  sourceIds: string[];
}
export interface PlacesCandidate {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  primaryType?: string;
}
export interface PublicPlacesMapping {
  branchId: string;
  placeId: string | null;
  mapsUrl: string | null;
  identityStatus: 'verified_match' | 'ambiguous' | 'needs_research' | 'needs_authorization' | 'api_error';
  checkedAt: string;
  sourceIds: string[];
  matchEvidenceSummary: string;
  observedGbpCategory: null;
  categoryStatus: 'needs_authorization';
}
function normalizedName(value: string): string { return value.toLowerCase().replace(/\b(?:llc|inc|ltd|limited)\b/g, '').replace(/[^a-z0-9]/g, ''); }
function normalizedStreet(value: string): string {
  return value.toLowerCase().replace(/\bwest\b/g, 'w').replace(/\beast\b/g, 'e').replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's').replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/[^a-z0-9]/g, '');
}
function domain(value: string): string | null { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } }
function phone(value: string): string { const digits = value.replace(/\D/g, ''); return digits.length === 10 ? `1${digits}` : digits; }

export function comparePlacesCandidate(facts: IndependentBranchFacts, candidate: PlacesCandidate) {
  // Compare the street before unit/floor details; unit data remains independently sourced.
  const street = facts.streetAddress.split(',')[0];
  const expectedDomain = domain(facts.website);
  return {
    companyName: [facts.companyName, ...(facts.nameAliases ?? [])].some(name => normalizedName(name) === normalizedName(candidate.displayName?.text ?? '')),
    streetAddress: !!street && normalizedStreet(candidate.formattedAddress ?? '').startsWith(normalizedStreet(street)),
    domain: !!expectedDomain && expectedDomain === domain(candidate.websiteUri ?? ''),
    telephone: phone(facts.telephone).length > 6 && phone(facts.telephone) === phone(candidate.internationalPhoneNumber ?? ''),
  };
}
export function buildGoogleMapsUrl(placeId: string, independentQuery: string): string {
  if (!/^[A-Za-z0-9_-]{10,255}$/.test(placeId)) throw new Error('Invalid Place ID');
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', independentQuery);
  url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

export async function resolvePlacesBranch(facts: IndependentBranchFacts, apiKey: string | undefined, fetcher: typeof fetch = fetch): Promise<PublicPlacesMapping> {
  const base: PublicPlacesMapping = { branchId: facts.branchId, placeId: null, mapsUrl: null, identityStatus: 'needs_research', checkedAt: new Date().toISOString(), sourceIds: facts.sourceIds, matchEvidenceSummary: 'No unique four-field match accepted.', observedGbpCategory: null, categoryStatus: 'needs_authorization' };
  if (!apiKey?.trim()) return { ...base, identityStatus: 'needs_authorization', matchEvidenceSummary: 'Places API credential required.' };
  if (!facts.sourceIds.length) return { ...base, matchEvidenceSummary: 'Independent branch evidence required before Google identity matching.' };
  try {
    const response = await fetcher('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber' }, body: JSON.stringify({ textQuery: `${facts.companyName} ${facts.streetAddress}`, pageSize: 5, languageCode: 'en', regionCode: 'US' }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { ...base, identityStatus: 'api_error', matchEvidenceSummary: `Official Places lookup returned HTTP ${response.status}; no API content retained.` };
    const data = await response.json() as { places?: PlacesCandidate[] };
    const accepted = (data.places ?? []).filter(candidate => Object.values(comparePlacesCandidate(facts, candidate)).every(Boolean));
    if (accepted.length !== 1) return { ...base, identityStatus: accepted.length > 1 ? 'ambiguous' : 'needs_research' };
    return { ...base, identityStatus: 'verified_match', placeId: accepted[0].id, mapsUrl: buildGoogleMapsUrl(accepted[0].id, facts.companyName), matchEvidenceSummary: 'Unique official Places record matched company-issued name, branch street, telephone, and domain. Company facts remain sourced independently.' };
  } catch {
    return { ...base, identityStatus: 'api_error', matchEvidenceSummary: 'Official Places lookup failed; credential and response content were not logged.' };
  }
}

export interface GbpCategory { name: string; displayName: string }
export type GbpCategoryLookup =
  | { status: 'needs_authorization'; categories: []; reason: string }
  | { status: 'api_error'; categories: []; reason: string }
  | { status: 'available'; categories: GbpCategory[]; source: 'official_category_catalog'; observedListingCategories: false };

/** Catalog availability does not prove which category a merchant selected. The
 * caller must read its specifically authorized location to make that assertion.
 * Return values are transient API content; do not export into the wiki corpus.
 */
export async function lookupGbpCategories(input: { accessToken?: string; prefix: string; regionCode: string; languageCode: string }, fetcher: typeof fetch = fetch): Promise<GbpCategoryLookup> {
  if (!input.accessToken?.trim()) return { status: 'needs_authorization', categories: [], reason: 'Business Profile OAuth token with business.manage scope required; a Places API key cannot read selected GBP categories.' };
  if (!/^[A-Z]{2}$/.test(input.regionCode) || !/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(input.languageCode) || !/^[\p{L}\p{N} -]{1,80}$/u.test(input.prefix)) return { status: 'api_error', categories: [], reason: 'Valid country, language, and category prefix are required.' };
  const categories: GbpCategory[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  try {
    do {
      const url = new URL('https://mybusinessbusinessinformation.googleapis.com/v1/categories');
      url.search = new URLSearchParams({ regionCode: input.regionCode, languageCode: input.languageCode, filter: `displayName=${input.prefix}`, pageSize: '100', view: 'BASIC', ...(pageToken ? { pageToken } : {}) }).toString();
      const response = await fetcher(url, { headers: { Authorization: `Bearer ${input.accessToken}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { status: 'api_error', categories: [], reason: `Business Profile category API returned HTTP ${response.status}` };
      const data = await response.json() as { categories?: GbpCategory[]; nextPageToken?: string };
      categories.push(...(data.categories ?? []).filter(category => /^categories\/[A-Za-z0-9_:-]+$/.test(category.name) && !!category.displayName));
      pageToken = data.nextPageToken;
      if (pageToken && seen.has(pageToken)) return { status: 'api_error', categories: [], reason: 'Category API repeated a pagination token' };
      if (pageToken) seen.add(pageToken);
      if (seen.size > 100) return { status: 'api_error', categories: [], reason: 'Category pagination exceeded request bound' };
    } while (pageToken);
    return { status: 'available', categories, source: 'official_category_catalog', observedListingCategories: false };
  } catch { return { status: 'api_error', categories: [], reason: 'Business Profile API unavailable; no credentials or API content logged.' }; }
}
