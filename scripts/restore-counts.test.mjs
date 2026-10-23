import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreSql } from './restore-counts.mjs';
const base = ['page','revision','archive','slots','slot_roles','content','content_models','text','actor','comment','user','user_groups','image','oldimage','filearchive'];
test('restoration checks are SELECT-only and retain all-client IDs, namespace, account and file validation', () => {
  const sql = restoreSql({ prefix: 'ew_', fingerprints: true });
  const statements = sql.split('\n').filter(line => line && !line.startsWith('--'));
  assert.ok(statements.every(statement => statement.startsWith('SELECT ') && statement.endsWith(';')));
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REPLACE)\b/i.test(statements.join('\n')));
  assert.match(sql, /FROM `ew_revision` ORDER BY rev_id/); assert.match(sql, /LEFT JOIN `ew_archive`/);
  assert.match(sql, /namespace_pages/); assert.match(sql, /account_digest/); assert.match(sql, /deleted_file_identity/);
  assert.match(sql, /page_id = 213/); assert.match(sql, /MAXPlaces_Marketing/);
  assert.ok(!sql.includes('SELECT *'));
});
test('prefix/table identifiers reject SQL injection and a partial table inventory fails closed', () => {
  assert.throws(() => restoreSql({ prefix: 'x`;DROP TABLE page;--' }), /Unsafe/);
  assert.throws(() => restoreSql({ tables: ['page'] }), /Required/);
  assert.throws(() => restoreSql({ tables: ['page;', 'revision'] }), /Identifiers/);
});
test('extension table inventories are counted instead of being silently omitted', () => {
  const sql = restoreSql({ tables: [...base, 'custom_extension_table'] });
  assert.match(sql, /'custom_extension_table' AS table_name, COUNT\(\*\) AS row_count FROM `custom_extension_table`/);
});
test('MediaWiki 1.39 external text storage is detected without emitting raw pointers', () => {
  const sql = restoreSql({ fingerprints: true });
  assert.match(sql, /'external_text_storage'.*FROM `text` WHERE FIND_IN_SET\('external', CONVERT\(old_flags USING utf8mb4\)\) > 0/);
  assert.match(sql, /'external_text_pointer_digest'.*SHA2\(old_text, 256\) AS pointer_digest/);
  assert.match(sql, /'content_identity'.*SHA2\(content_address, 256\) AS address_digest/);
  assert.ok(!sql.includes('HEX(content_address)'));
  assert.ok(!sql.split('\n').some(line => /^SELECT .*\b(?:old_text|content_address)\s+(?:AS|FROM)/.test(line)));
  assert.match(sql, /ExternalStore backing content/);
});
test('optional ecosystem tables use the actual inventory and REL1_39 template target associations', () => {
  const optional = ['linktarget','category','categorylinks','pagelinks','templatelinks','imagelinks','externallinks','langlinks','redirect','interwiki','logging','log_search','page_restrictions','protected_titles','user_properties','user_former_groups','ipblocks','ipblocks_restrictions','watchlist','watchlist_expiry','bot_passwords','job','objectcache','querycache','querycache_info','querycachetwo','l10n_cache','page_props','updatelog','site_stats','sites'];
  const sql = restoreSql({ prefix: 'wiki_', tables: [...base, ...optional, 'tenant_custom'].map(name => 'wiki_' + name), fingerprints: true });
  for (const name of optional) assert.match(sql, new RegExp("'" + name + "_row_digest' AS metric, SHA2"));
  for (const metric of ['orphan_template_targets','orphan_categorylinks_source_pages','redirect_page_without_row','orphan_log_actors','orphan_log_search_entries','orphan_user_properties_users','orphan_block_restrictions','orphan_watchlist_expiries','quarantined_job_summary','local_cache_summary']) assert.ok(sql.includes("'" + metric + "'"), metric);
  assert.match(sql, /`wiki_templatelinks` links LEFT JOIN `wiki_linktarget` target ON target\.lt_id = links\.tl_target_id/);
  assert.ok(!/\btl_(?:namespace|title)\b/.test(sql), '1.39 templatelinks uses linktarget rather than old title columns');
  assert.match(sql, /'tenant_custom'|\bwiki_tenant_custom\b/);
  const statements = sql.split('\n').filter(line => line && !line.startsWith('--'));
  assert.ok(statements.every(statement => statement.startsWith('SELECT ') && statement.endsWith(';')));
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REPLACE)\b/i.test(statements.join('\n')));
  assert.match(sql, /'job_row_digest'.*HEX\(`job_params`\)/);
  assert.match(sql, /'bot_passwords_row_digest'.*HEX\(`bp_password`\)/);
  assert.match(sql, /'objectcache_row_digest'.*HEX\(`value`\)/);
});
test('missing optional tables are explicit and never queried; linked checks require both tables', () => {
  const sql = restoreSql({ tables: [...base, 'templatelinks'], fingerprints: true });
  assert.match(sql, /Optional table linktarget is not listed/);
  assert.match(sql, /'templatelinks_row_digest'/);
  assert.match(sql, /'orphan_templatelinks_source_pages'/);
  assert.ok(!sql.includes("'orphan_template_targets'"));
  assert.ok(!/\b(?:FROM|JOIN) `(?:linktarget|job|objectcache|interwiki)`/.test(sql));
});
