import assert from 'node:assert/strict';
import { test } from 'node:test';
import { additionalTypeExportDecision, declaresExpectedProductOntologyClass, deriveConceptUrls, type OfferingClassMapping } from './ontology.ts';
import { buildGoogleMapsUrl, comparePlacesCandidate, lookupGbpCategories, resolvePlacesBranch } from './google.ts';

test('semantic candidates require supplied English Wikipedia identity and preserve canonical entity/document split', () => {
  const urls = deriveConceptUrls('https://en.wikipedia.org/wiki/Search_engine_optimization?company#section');
  assert.equal(urls?.productOntologyClassUri, 'http://www.productontology.org/id/Search_engine_optimization');
  assert.equal(urls?.productOntologyDocumentUrl, 'http://www.productontology.org/doc/Search_engine_optimization');
  assert.equal(urls?.dbpediaResourceUri, 'https://dbpedia.org/resource/Search_engine_optimization');
  assert.equal(deriveConceptUrls('https://evil.example/wiki/Search_engine_optimization'), null);
  assert.equal(deriveConceptUrls('https://en.wikipedia.org.evil.example/wiki/SEO'), null);
  assert.equal(deriveConceptUrls('https://en.wikipedia.org/wiki/Category:Marketing'), null);
  assert.equal(deriveConceptUrls('SEO'), null);
});

test('transport reachability alone cannot accept a company identity or service class assignment', () => {
  const uri = 'http://www.productontology.org/id/Search_engine_optimization';
  const mapping: OfferingClassMapping = { subjectId: 'seo-service', subjectKind: 'service', relation: 'additionalType', targetClassUri: uri, wikipediaUrl: 'https://en.wikipedia.org/wiki/Search_engine_optimization', semanticDecision: 'candidate', evidenceIds: ['first-party-seo'], rationale: 'Offering explicitly supplies SEO', reviewedBy: 'Pilot reviewer', availability: { checkedAt: '2026-10-23', requestedUrl: `${uri}.ttl`, canonicalClassUri: uri, status: 'class_declared', httpStatus: 200 } };
  assert.equal(additionalTypeExportDecision(mapping).accepted, false);
  assert.equal(additionalTypeExportDecision({ ...mapping, semanticDecision: 'accepted' }).accepted, true);
  assert.equal(additionalTypeExportDecision({ ...mapping, semanticDecision: 'accepted', subjectKind: 'organization' }).accepted, false);
  assert.equal(additionalTypeExportDecision({ ...mapping, semanticDecision: 'accepted', relation: 'sameAs' }).accepted, false);
  assert.equal(additionalTypeExportDecision({ ...mapping, semanticDecision: 'accepted', availability: { ...mapping.availability, status: 'not_declared' } }).accepted, false);
});

test('Product Ontology declaration must be the exact class and correct OWL namespace', () => {
  const uri = 'http://www.productontology.org/id/Digital_marketing';
  const ttl = `@prefix owl: <http://www.w3.org/2002/07/owl#>.\n<${uri}> a owl:Class;`;
  assert.equal(declaresExpectedProductOntologyClass(ttl, uri), true);
  assert.equal(declaresExpectedProductOntologyClass(ttl, `${uri}_unrelated`), false);
  assert.equal(declaresExpectedProductOntologyClass(ttl.replace('2002/07/owl#', 'evil.example/'), uri), false);
});

const facts = { branchId: 'nyc', companyName: 'MAXPlaces Marketing, LLC', streetAddress: '127 West 30th Street, 9th Floor #989', telephone: '+1 212-651-1879', website: 'https://www.maxplaces.com/', sourceIds: ['company-contact'] };
const candidate = { id: 'ChIJQ0NGoBZZwokRkcPfab5d5rk', displayName: { text: 'MAXPlaces Marketing, LLC' }, formattedAddress: '127 W 30th St, New York, NY', internationalPhoneNumber: '+1 212-651-1879', websiteUri: 'https://maxplaces.com/' };

test('branch identity requires all four fields and normalizes directional street abbreviations', () => {
  assert.deepEqual(comparePlacesCandidate(facts, candidate), { companyName: true, streetAddress: true, domain: true, telephone: true });
  assert.equal(comparePlacesCandidate(facts, { ...candidate, websiteUri: 'https://evilmaxplaces.com/' }).domain, false);
  assert.equal(comparePlacesCandidate(facts, { ...candidate, formattedAddress: '399 Conklin St, Farmingdale' }).streetAddress, false);
  const link = new URL(buildGoogleMapsUrl(candidate.id, facts.companyName));
  assert.equal(link.searchParams.get('query_place_id'), candidate.id);
  assert.equal(link.searchParams.get('api'), '1');
});

test('Places resolver discards platform content and never fabricates selected GBP categories', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ places: [candidate] }), { status: 200 })) as typeof fetch;
  const result = await resolvePlacesBranch(facts, 'runtime-only-key', fetcher);
  assert.equal(result.identityStatus, 'verified_match');
  assert.equal(result.placeId, candidate.id);
  assert.equal(result.observedGbpCategory, null);
  assert.equal('primaryType' in result, false);
  assert.equal('formattedAddress' in result, false);
  assert.equal(JSON.stringify(result).includes('runtime-only-key'), false);
  const ambiguous = await resolvePlacesBranch(facts, 'runtime-only-key', (async () => new Response(JSON.stringify({ places: [candidate, { ...candidate, id: 'ChIJDifferentPlaceId' }] }))) as typeof fetch);
  assert.equal(ambiguous.identityStatus, 'ambiguous');
  assert.equal(ambiguous.placeId, null);
});

test('GBP adapter reports missing authorization without making any request', async () => {
  let requested = false;
  const result = await lookupGbpCategories({ prefix: 'Internet marketing', regionCode: 'US', languageCode: 'en' }, (async () => { requested = true; throw new Error('No request expected'); }) as typeof fetch);
  assert.equal(result.status, 'needs_authorization');
  assert.equal(requested, false);
});

test('GBP category catalog pagination preserves official identifiers and never asserts listing selection', async () => {
  const urls: string[] = [];
  const result = await lookupGbpCategories({ accessToken: 'runtime-only-token', prefix: 'Internet', regionCode: 'US', languageCode: 'en' }, (async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify(urls.length === 1 ? { categories: [{ name: 'categories/gcid:internet_marketing_service', displayName: 'Internet marketing service' }], nextPageToken: 'next' } : { categories: [{ name: 'categories/official_id', displayName: 'Internet service provider' }] }));
  }) as typeof fetch);
  assert.equal(result.status, 'available');
  if (result.status === 'available') { assert.equal(result.observedListingCategories, false); assert.equal(result.categories[0]?.name, 'categories/gcid:internet_marketing_service'); assert.equal(result.categories.at(-1)?.name, 'categories/official_id'); }
  assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'next');
});

test('all six live pilot authority artifacts pass exact class and export gates with matching hashes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const root = new URL('../../tests/fixtures/ontology/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source-manifest.json', root), 'utf8')) as { entries: { id: string; sha256: string; bodyPath: string }[] };
  const supplement = JSON.parse(await readFile(new URL('ontology-mappings.json', root), 'utf8')) as { mappings: OfferingClassMapping[] };
  assert.equal(supplement.mappings.length, 6);
  for (const mapping of supplement.mappings) {
    assert.equal(additionalTypeExportDecision(mapping).accepted, true, mapping.subjectId);
    const authority = manifest.entries.find(entry => entry.id === deriveConceptUrls(mapping.wikipediaUrl)?.wikipediaTitle)!;
    const bytes = await readFile(new URL(authority.bodyPath, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), authority.sha256);
    assert.equal(authority.sha256, mapping.availability.sha256);
    assert.equal(declaresExpectedProductOntologyClass(bytes.toString(), mapping.targetClassUri), true);
  }
});
