import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreSql } from './restore-counts.mjs';
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
  const base = ['page','revision','archive','slots','slot_roles','content','content_models','text','actor','comment','user','user_groups','image','oldimage','filearchive'];
  const sql = restoreSql({ tables: [...base, 'custom_extension_table'] });
  assert.match(sql, /'custom_extension_table' AS table_name, COUNT\(\*\) AS row_count FROM `custom_extension_table`/);
});
