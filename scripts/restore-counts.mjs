#!/usr/bin/env node
/** Emits SELECT-only MediaWiki 1.39 recovery checks. No network, DB client or credentials. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REQUIRED = ['page', 'revision', 'archive', 'slots', 'slot_roles', 'content', 'content_models', 'text', 'actor', 'comment', 'user', 'user_groups', 'image', 'oldimage', 'filearchive'];
const identifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new Error('Identifiers must contain only ASCII letters, digits and underscores (1–64 characters)');
  return '`' + value + '`';
};
export function restoreSql({ prefix = '', tables, fingerprints = false } = {}) {
  if (prefix && !/^[A-Za-z0-9_]{1,40}$/.test(prefix)) throw new Error('Unsafe MediaWiki table prefix');
  const t = name => identifier(prefix + name);
  const actual = tables ?? REQUIRED.map(name => prefix + name);
  for (const table of actual) identifier(table);
  const missing = REQUIRED.filter(name => !actual.includes(prefix + name));
  if (missing.length) throw new Error('Required MediaWiki 1.39 tables missing from inventory: ' + missing.join(', '));
  const queries = [
    '-- PRIVATE restoration evidence. Execute only against the intended schema using a SELECT-only account.',
    tables ? '-- Scope: counts cover every table in the supplied actual inventory; independently confirm that inventory is complete.' : '-- Scope: essential core diagnostics only. Full restore acceptance requires --table-list with the actual complete schema inventory.',
    '-- Compare the untouched backup-baseline restore with the destination before running application jobs/upgrades.',
    '-- Missing schema/column errors are failures to investigate; never silently skip tables.',
    "SELECT 'environment' AS metric, VERSION() AS server_version, @@version_comment AS database_family, DATABASE() AS selected_database, @@sql_mode AS sql_mode, @@character_set_server AS server_charset, @@collation_server AS server_collation;",
    "SELECT 'table_inventory' AS metric, TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;",
    "SELECT 'column_inventory' AS metric, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION;",
    "SELECT 'trigger_inventory' AS metric, TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME;",
  ];
  for (const name of [...new Set(actual)].sort()) queries.push(`SELECT 'table_count' AS metric, '${name}' AS table_name, COUNT(*) AS row_count FROM ${identifier(name)};`);
  queries.push(
    `SELECT 'namespace_pages' AS metric, page_namespace, COUNT(*) AS page_count, MIN(page_id) AS minimum_id, MAX(page_id) AS maximum_id FROM ${t('page')} GROUP BY page_namespace ORDER BY page_namespace;`,
    `SELECT 'revision_range' AS metric, COUNT(*) AS revision_count, MIN(rev_id) AS minimum_id, MAX(rev_id) AS maximum_id, MIN(rev_timestamp) AS earliest, MAX(rev_timestamp) AS latest, SUM(rev_len) AS declared_content_bytes FROM ${t('revision')};`,
    `SELECT 'archived_revision_range' AS metric, COUNT(*) AS revision_count, MIN(ar_rev_id) AS minimum_id, MAX(ar_rev_id) AS maximum_id, SUM(ar_len) AS declared_content_bytes FROM ${t('archive')};`,
    `SELECT 'slot_roles' AS metric, slot_role_id, COUNT(*) AS slot_count FROM ${t('slots')} GROUP BY slot_role_id ORDER BY slot_role_id;`,
    `SELECT 'content_addresses' AS metric, SUBSTRING_INDEX(content_address, ':', 1) AS storage_kind, COUNT(*) AS content_count, SUM(content_size) AS content_bytes FROM ${t('content')} GROUP BY SUBSTRING_INDEX(content_address, ':', 1) ORDER BY storage_kind;`,
    `SELECT 'stored_text' AS metric, COUNT(*) AS text_count, SUM(OCTET_LENGTH(old_text)) AS stored_bytes FROM ${t('text')};`,
    `SELECT 'current_files' AS metric, COUNT(*) AS files, SUM(img_size) AS bytes FROM ${t('image')};`,
    `SELECT 'old_files' AS metric, COUNT(*) AS versions, SUM(oi_size) AS bytes FROM ${t('oldimage')};`,
    `SELECT 'deleted_files' AS metric, COUNT(*) AS versions, SUM(fa_size) AS bytes FROM ${t('filearchive')};`,
    `SELECT 'orphan_live_revisions' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('page')} p ON p.page_id = r.rev_page WHERE p.page_id IS NULL;`,
    `SELECT 'invalid_page_latest' AS metric, COUNT(*) AS orphan_count FROM ${t('page')} p LEFT JOIN ${t('revision')} r ON r.rev_id = p.page_latest AND r.rev_page = p.page_id WHERE r.rev_id IS NULL;`,
    `SELECT 'orphan_slot_contents' AS metric, COUNT(*) AS orphan_count FROM ${t('slots')} s LEFT JOIN ${t('content')} c ON c.content_id = s.slot_content_id WHERE c.content_id IS NULL;`,
    `SELECT 'orphan_slot_revisions' AS metric, COUNT(*) AS orphan_count FROM ${t('slots')} s LEFT JOIN ${t('revision')} r ON r.rev_id = s.slot_revision_id LEFT JOIN ${t('archive')} a ON a.ar_rev_id = s.slot_revision_id WHERE r.rev_id IS NULL AND a.ar_rev_id IS NULL;`,
    `SELECT 'missing_local_text' AS metric, COUNT(*) AS orphan_count FROM ${t('content')} c LEFT JOIN ${t('text')} tx ON tx.old_id = CAST(SUBSTRING(c.content_address, 4) AS UNSIGNED) WHERE c.content_address REGEXP '^tt:[0-9]+$' AND tx.old_id IS NULL;`,
    `SELECT 'orphan_revision_actors' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('actor')} a ON a.actor_id = r.rev_actor WHERE a.actor_id IS NULL;`,
    `SELECT 'orphan_actor_users' AS metric, COUNT(*) AS orphan_count FROM ${t('actor')} a LEFT JOIN ${t('user')} u ON u.user_id = a.actor_user WHERE a.actor_user IS NOT NULL AND a.actor_user <> 0 AND u.user_id IS NULL;`,
    `SELECT 'maxplaces_identity' AS metric, page_id, page_namespace, HEX(page_title) AS title_hex, page_latest FROM ${t('page')} WHERE page_id = 213 OR (page_namespace = 0 AND page_title = 'MAXPlaces_Marketing') ORDER BY page_id;`,
    `SELECT 'maxplaces_history' AS metric, rev_id, rev_page, rev_timestamp, rev_actor, rev_parent_id, rev_deleted, rev_len, rev_sha1 FROM ${t('revision')} WHERE rev_page = 213 ORDER BY rev_id;`,
  );
  if (fingerprints) queries.push(
    '-- Ordered row digests supplement counts; retain output privately. They do not replace original dump/files checksums.',
    `SELECT 'page_identity' AS metric, page_id, page_namespace, HEX(page_title), page_latest, page_is_redirect FROM ${t('page')} ORDER BY page_id;`,
    `SELECT 'revision_identity' AS metric, rev_id, rev_page, rev_timestamp, rev_actor, rev_comment_id, rev_parent_id, rev_deleted, rev_len, rev_sha1 FROM ${t('revision')} ORDER BY rev_id;`,
    `SELECT 'archive_identity' AS metric, ar_id, ar_rev_id, ar_namespace, HEX(ar_title), ar_actor, ar_comment_id, ar_deleted, ar_sha1 FROM ${t('archive')} ORDER BY ar_id;`,
    `SELECT 'slot_identity' AS metric, slot_revision_id, slot_role_id, slot_content_id, slot_origin FROM ${t('slots')} ORDER BY slot_revision_id, slot_role_id;`,
    `SELECT 'content_identity' AS metric, content_id, content_size, content_sha1, content_model, HEX(content_address) FROM ${t('content')} ORDER BY content_id;`,
    `SELECT 'text_digest' AS metric, old_id, OCTET_LENGTH(old_text), SHA2(old_text, 256), HEX(old_flags) FROM ${t('text')} ORDER BY old_id;`,
    `SELECT 'account_digest' AS metric, user_id, SHA2(CONCAT(HEX(user_name), ':', HEX(user_real_name), ':', HEX(user_email), ':', HEX(user_password), ':', HEX(user_newpassword), ':', HEX(user_token)), 256) FROM ${t('user')} ORDER BY user_id;`,
    `SELECT 'group_identity' AS metric, ug_user, HEX(ug_group), HEX(ug_expiry) FROM ${t('user_groups')} ORDER BY ug_user, ug_group;`,
    `SELECT 'current_file_identity' AS metric, HEX(img_name), img_size, img_sha1, img_timestamp, img_actor, SHA2(img_metadata, 256) FROM ${t('image')} ORDER BY img_name;`,
    `SELECT 'old_file_identity' AS metric, HEX(oi_name), HEX(oi_archive_name), oi_size, oi_sha1, oi_timestamp, oi_actor, oi_deleted FROM ${t('oldimage')} ORDER BY oi_name, oi_archive_name, oi_timestamp;`,
    `SELECT 'deleted_file_identity' AS metric, fa_id, HEX(fa_name), HEX(fa_storage_key), fa_size, fa_sha1, fa_actor, fa_deleted FROM ${t('filearchive')} ORDER BY fa_id;`,
  );
  return queries.join('\n') + '\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), prefixIndex = args.indexOf('--prefix'), listIndex = args.indexOf('--table-list');
  try {
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--fingerprints') continue;
      if (['--prefix', '--table-list'].includes(args[index])) {
        if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error('A required option value is missing');
        index++; continue;
      }
      throw new Error('Unsupported option; use --prefix, --table-list and/or --fingerprints');
    }
    const tables = listIndex >= 0 ? (await readFile(args[listIndex + 1], 'utf8')).split(/\s+/).filter(Boolean) : undefined;
    process.stdout.write(restoreSql({ prefix: prefixIndex >= 0 ? args[prefixIndex + 1] : '', tables, fingerprints: args.includes('--fingerprints') }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
