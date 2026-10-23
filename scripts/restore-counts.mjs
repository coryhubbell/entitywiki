#!/usr/bin/env node
/** Emits SELECT-only MediaWiki 1.39 recovery checks. No network, DB client or credentials. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REQUIRED = ['page', 'revision', 'archive', 'slots', 'slot_roles', 'content', 'content_models', 'text', 'actor', 'comment', 'user', 'user_groups', 'image', 'oldimage', 'filearchive'];
// Columns verified against MediaWiki REL1_39/maintenance/tables-generated.sql.
// Optional tables are diagnosed only when the supplied actual inventory lists them.
// Custom/extension tables still receive counts and schema inventory; their semantics
// need a separate extension-specific acceptance decision.
const ECOSYSTEM_ROWS = {
  linktarget: ['lt_id', 'lt_namespace', 'lt_title'],
  category: ['cat_id', 'cat_title', 'cat_pages', 'cat_subcats', 'cat_files'],
  categorylinks: ['cl_from', 'cl_to', 'cl_sortkey', 'cl_sortkey_prefix', 'cl_timestamp', 'cl_collation', 'cl_type'],
  pagelinks: ['pl_from', 'pl_namespace', 'pl_title', 'pl_from_namespace'],
  templatelinks: ['tl_from', 'tl_target_id', 'tl_from_namespace'],
  imagelinks: ['il_from', 'il_to', 'il_from_namespace'],
  externallinks: ['el_id', 'el_from', 'el_to', 'el_index', 'el_index_60'],
  langlinks: ['ll_from', 'll_lang', 'll_title'],
  redirect: ['rd_from', 'rd_namespace', 'rd_title', 'rd_interwiki', 'rd_fragment'],
  interwiki: ['iw_prefix', 'iw_url', 'iw_api', 'iw_wikiid', 'iw_local', 'iw_trans'],
  logging: ['log_id', 'log_type', 'log_action', 'log_timestamp', 'log_actor', 'log_namespace', 'log_title', 'log_page', 'log_comment_id', 'log_params', 'log_deleted'],
  log_search: ['ls_field', 'ls_value', 'ls_log_id'],
  user_properties: ['up_user', 'up_property', 'up_value'],
  user_former_groups: ['ufg_user', 'ufg_group'],
  page_restrictions: ['pr_id', 'pr_page', 'pr_type', 'pr_level', 'pr_cascade', 'pr_expiry'],
  protected_titles: ['pt_namespace', 'pt_title', 'pt_user', 'pt_reason_id', 'pt_timestamp', 'pt_expiry', 'pt_create_perm'],
  ipblocks: ['ipb_id', 'ipb_address', 'ipb_user', 'ipb_by_actor', 'ipb_reason_id', 'ipb_timestamp', 'ipb_auto', 'ipb_anon_only', 'ipb_create_account', 'ipb_enable_autoblock', 'ipb_expiry', 'ipb_range_start', 'ipb_range_end', 'ipb_deleted', 'ipb_block_email', 'ipb_allow_usertalk', 'ipb_parent_block_id', 'ipb_sitewide'],
  ipblocks_restrictions: ['ir_ipb_id', 'ir_type', 'ir_value'],
  watchlist: ['wl_id', 'wl_user', 'wl_namespace', 'wl_title', 'wl_notificationtimestamp'],
  watchlist_expiry: ['we_item', 'we_expiry'],
  bot_passwords: ['bp_user', 'bp_app_id', 'bp_password', 'bp_token', 'bp_restrictions', 'bp_grants'],
  job: ['job_id', 'job_cmd', 'job_namespace', 'job_title', 'job_timestamp', 'job_params', 'job_random', 'job_attempts', 'job_token', 'job_token_timestamp', 'job_sha1'],
  objectcache: ['keyname', 'value', 'exptime', 'modtoken', 'flags'],
  querycache: ['qc_type', 'qc_value', 'qc_namespace', 'qc_title'],
  querycache_info: ['qci_type', 'qci_timestamp'],
  querycachetwo: ['qcc_type', 'qcc_value', 'qcc_namespace', 'qcc_title', 'qcc_namespacetwo', 'qcc_titletwo'],
  l10n_cache: ['lc_lang', 'lc_key', 'lc_value'],
  page_props: ['pp_page', 'pp_propname', 'pp_value', 'pp_sortkey'],
  updatelog: ['ul_key', 'ul_value'],
  site_stats: ['ss_row_id', 'ss_total_edits', 'ss_good_articles', 'ss_total_pages', 'ss_users', 'ss_active_users', 'ss_images'],
  sites: ['site_id', 'site_global_key', 'site_type', 'site_group', 'site_source', 'site_language', 'site_protocol', 'site_domain', 'site_data', 'site_forward', 'site_config'],
};
const identifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new Error('Identifiers must contain only ASCII letters, digits and underscores (1–64 characters)');
  return '`' + value + '`';
};
export function restoreSql({ prefix = '', tables, fingerprints = false } = {}) {
  if (prefix && !/^[A-Za-z0-9_]{1,40}$/.test(prefix)) throw new Error('Unsafe MediaWiki table prefix');
  const t = name => identifier(prefix + name);
  const actual = tables ?? REQUIRED.map(name => prefix + name);
  const present = name => actual.includes(prefix + name);
  for (const table of actual) identifier(table);
  const missing = REQUIRED.filter(name => !actual.includes(prefix + name));
  if (missing.length) throw new Error('Required MediaWiki 1.39 tables missing from inventory: ' + missing.join(', '));
  const queries = [
    '-- PRIVATE restoration evidence. Execute only against the intended schema using a SELECT-only account.',
    tables ? '-- Scope: counts cover every table in the supplied actual inventory; independently confirm that inventory is complete.' : '-- Scope: essential core diagnostics only. Full restore acceptance requires --table-list with the actual complete schema inventory.',
    '-- Compare the untouched backup-baseline restore with the destination before running application jobs/upgrades.',
    '-- Missing schema/column errors are failures to investigate; never silently skip tables.',
    '-- Core schema reference: https://raw.githubusercontent.com/wikimedia/mediawiki/REL1_39/maintenance/tables-generated.sql',
    '-- Page/namespace identity is not client ownership. Reconcile every source page to a reviewed client/entity or preserved non-entity role separately.',
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
    `SELECT 'text_storage_flags' AS metric, HEX(old_flags) AS flags_hex, COUNT(*) AS text_count, SUM(OCTET_LENGTH(old_text)) AS stored_bytes FROM ${t('text')} GROUP BY old_flags ORDER BY old_flags;`,
    `SELECT 'external_text_storage' AS metric, COUNT(*) AS external_pointer_count, SUM(OCTET_LENGTH(old_text)) AS pointer_bytes FROM ${t('text')} WHERE FIND_IN_SET('external', CONVERT(old_flags USING utf8mb4)) > 0;`,
    `SELECT 'current_files' AS metric, COUNT(*) AS files, SUM(img_size) AS bytes FROM ${t('image')};`,
    `SELECT 'old_files' AS metric, COUNT(*) AS versions, SUM(oi_size) AS bytes FROM ${t('oldimage')};`,
    `SELECT 'deleted_files' AS metric, COUNT(*) AS versions, SUM(fa_size) AS bytes FROM ${t('filearchive')};`,
    `SELECT 'orphan_live_revisions' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('page')} p ON p.page_id = r.rev_page WHERE p.page_id IS NULL;`,
    `SELECT 'invalid_page_latest' AS metric, COUNT(*) AS orphan_count FROM ${t('page')} p LEFT JOIN ${t('revision')} r ON r.rev_id = p.page_latest AND r.rev_page = p.page_id WHERE r.rev_id IS NULL;`,
    `SELECT 'orphan_slot_contents' AS metric, COUNT(*) AS orphan_count FROM ${t('slots')} s LEFT JOIN ${t('content')} c ON c.content_id = s.slot_content_id WHERE c.content_id IS NULL;`,
    `SELECT 'orphan_slot_revisions' AS metric, COUNT(*) AS orphan_count FROM ${t('slots')} s LEFT JOIN ${t('revision')} r ON r.rev_id = s.slot_revision_id LEFT JOIN ${t('archive')} a ON a.ar_rev_id = s.slot_revision_id WHERE r.rev_id IS NULL AND a.ar_rev_id IS NULL;`,
    `SELECT 'missing_local_text' AS metric, COUNT(*) AS orphan_count FROM ${t('content')} c LEFT JOIN ${t('text')} tx ON tx.old_id = CAST(SUBSTRING(c.content_address, 4) AS UNSIGNED) WHERE c.content_address REGEXP '^tt:[0-9]+$' AND tx.old_id IS NULL;`,
    `SELECT 'orphan_revision_actors' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('actor')} a ON a.actor_id = r.rev_actor WHERE a.actor_id IS NULL;`,
    `SELECT 'orphan_archived_actors' AS metric, COUNT(*) AS orphan_count FROM ${t('archive')} r LEFT JOIN ${t('actor')} a ON a.actor_id = r.ar_actor WHERE a.actor_id IS NULL;`,
    `SELECT 'orphan_revision_comments' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('comment')} c ON c.comment_id = r.rev_comment_id WHERE c.comment_id IS NULL;`,
    `SELECT 'missing_revision_parents' AS metric, COUNT(*) AS orphan_count FROM ${t('revision')} r LEFT JOIN ${t('revision')} parent ON parent.rev_id = r.rev_parent_id LEFT JOIN ${t('archive')} a ON a.ar_rev_id = r.rev_parent_id WHERE r.rev_parent_id <> 0 AND parent.rev_id IS NULL AND a.ar_rev_id IS NULL;`,
    `SELECT 'orphan_actor_users' AS metric, COUNT(*) AS orphan_count FROM ${t('actor')} a LEFT JOIN ${t('user')} u ON u.user_id = a.actor_user WHERE a.actor_user IS NOT NULL AND a.actor_user <> 0 AND u.user_id IS NULL;`,
    `SELECT 'orphan_group_users' AS metric, COUNT(*) AS orphan_count FROM ${t('user_groups')} g LEFT JOIN ${t('user')} u ON u.user_id = g.ug_user WHERE u.user_id IS NULL;`,
    `SELECT 'maxplaces_identity' AS metric, page_id, page_namespace, HEX(page_title) AS title_hex, page_latest FROM ${t('page')} WHERE page_id = 213 OR (page_namespace = 0 AND page_title = 'MAXPlaces_Marketing') ORDER BY page_id;`,
    `SELECT 'maxplaces_history' AS metric, rev_id, rev_page, rev_timestamp, rev_actor, rev_parent_id, rev_deleted, rev_len, rev_sha1 FROM ${t('revision')} WHERE rev_page = 213 ORDER BY rev_id;`,
  );
  if (fingerprints) queries.push(
    '-- Ordered row digests supplement counts; retain output privately. They do not replace original dump/files checksums.',
    `SELECT 'page_identity' AS metric, page_id, page_namespace, HEX(page_title), page_latest, page_is_redirect FROM ${t('page')} ORDER BY page_id;`,
    `SELECT 'revision_identity' AS metric, rev_id, rev_page, rev_timestamp, rev_actor, rev_comment_id, rev_parent_id, rev_deleted, rev_len, rev_sha1 FROM ${t('revision')} ORDER BY rev_id;`,
    `SELECT 'archive_identity' AS metric, ar_id, ar_rev_id, ar_namespace, HEX(ar_title), ar_actor, ar_comment_id, ar_deleted, ar_sha1 FROM ${t('archive')} ORDER BY ar_id;`,
    `SELECT 'slot_identity' AS metric, slot_revision_id, slot_role_id, slot_content_id, slot_origin FROM ${t('slots')} ORDER BY slot_revision_id, slot_role_id;`,
    `SELECT 'content_identity' AS metric, content_id, content_size, content_sha1, content_model, SHA2(content_address, 256) AS address_digest FROM ${t('content')} ORDER BY content_id;`,
    `SELECT 'text_digest' AS metric, old_id, OCTET_LENGTH(old_text), SHA2(old_text, 256), HEX(old_flags) FROM ${t('text')} ORDER BY old_id;`,
    `SELECT 'external_text_pointer_digest' AS metric, old_id, SHA2(old_text, 256) AS pointer_digest, HEX(old_flags) AS flags_hex FROM ${t('text')} WHERE FIND_IN_SET('external', CONVERT(old_flags USING utf8mb4)) > 0 ORDER BY old_id;`,
    `SELECT 'account_digest' AS metric, user_id, SHA2(CONCAT(HEX(user_name), ':', HEX(user_real_name), ':', HEX(user_email), ':', HEX(user_password), ':', HEX(user_newpassword), ':', HEX(user_token)), 256) FROM ${t('user')} ORDER BY user_id;`,
    `SELECT 'group_identity' AS metric, ug_user, HEX(ug_group), HEX(ug_expiry) FROM ${t('user_groups')} ORDER BY ug_user, ug_group;`,
    `SELECT 'current_file_identity' AS metric, HEX(img_name), img_size, img_sha1, img_timestamp, img_actor, SHA2(img_metadata, 256) FROM ${t('image')} ORDER BY img_name;`,
    `SELECT 'old_file_identity' AS metric, HEX(oi_name), HEX(oi_archive_name), oi_size, oi_sha1, oi_timestamp, oi_actor, oi_deleted FROM ${t('oldimage')} ORDER BY oi_name, oi_archive_name, oi_timestamp;`,
    `SELECT 'deleted_file_identity' AS metric, fa_id, HEX(fa_name), HEX(fa_storage_key), fa_size, fa_sha1, fa_actor, fa_deleted FROM ${t('filearchive')} ORDER BY fa_id;`,
  );
  queries.push('-- Ecosystem diagnostics below are conditional on the actual table inventory, not assumptions from the public page archive.');
  for (const [name, columns] of Object.entries(ECOSYSTEM_ROWS)) {
    if (!present(name)) {
      queries.push(`-- Optional table ${prefix + name} is not listed; its subsystem is not diagnosed here. Confirm absence against the complete source schema.`);
      continue;
    }
    if (fingerprints) {
      // Hex values are joined with explicit NULL markers before hashing. No job
      // parameters, password material, cache values, URLs or private notes are emitted.
      const fields = columns.map(column => `IF(${identifier(column)} IS NULL, 'N', CONCAT('V', HEX(${identifier(column)})))`);
      queries.push(`SELECT '${name}_row_digest' AS metric, SHA2(CONCAT_WS(':', ${fields.join(', ')}), 256) AS row_digest FROM ${t(name)} ORDER BY row_digest;`);
    }
  }
  for (const [name, column] of [['categorylinks', 'cl_from'], ['pagelinks', 'pl_from'], ['templatelinks', 'tl_from'], ['imagelinks', 'il_from'], ['externallinks', 'el_from'], ['langlinks', 'll_from'], ['redirect', 'rd_from'], ['page_restrictions', 'pr_page'], ['page_props', 'pp_page']]) {
    if (present(name)) queries.push(`SELECT 'orphan_${name}_source_pages' AS metric, COUNT(*) AS orphan_count FROM ${t(name)} links LEFT JOIN ${t('page')} p ON p.page_id = links.${identifier(column)} WHERE p.page_id IS NULL;`);
  }
  for (const [name, column] of [['user_properties', 'up_user'], ['user_former_groups', 'ufg_user'], ['watchlist', 'wl_user'], ['bot_passwords', 'bp_user']]) {
    if (present(name)) queries.push(`SELECT 'orphan_${name}_users' AS metric, COUNT(*) AS orphan_count FROM ${t(name)} refs LEFT JOIN ${t('user')} u ON u.user_id = refs.${identifier(column)} WHERE u.user_id IS NULL;`);
  }
  if (present('templatelinks') && present('linktarget')) queries.push(`SELECT 'orphan_template_targets' AS metric, COUNT(*) AS orphan_count FROM ${t('templatelinks')} links LEFT JOIN ${t('linktarget')} target ON target.lt_id = links.tl_target_id WHERE target.lt_id IS NULL;`);
  if (present('categorylinks')) queries.push(`SELECT 'category_membership_types' AS metric, cl_type, COUNT(*) AS membership_count FROM ${t('categorylinks')} GROUP BY cl_type ORDER BY cl_type;`);
  if (present('categorylinks') && present('category')) queries.push(`SELECT 'category_membership_without_category_row' AS metric, COUNT(*) AS mismatch_count FROM ${t('categorylinks')} links LEFT JOIN ${t('category')} category ON category.cat_title = links.cl_to WHERE category.cat_id IS NULL;`);
  if (present('redirect')) queries.push(
    `SELECT 'redirect_row_without_page_flag' AS metric, COUNT(*) AS mismatch_count FROM ${t('redirect')} redirects JOIN ${t('page')} p ON p.page_id = redirects.rd_from WHERE p.page_is_redirect = 0;`,
    `SELECT 'redirect_page_without_row' AS metric, COUNT(*) AS mismatch_count FROM ${t('page')} p LEFT JOIN ${t('redirect')} redirects ON redirects.rd_from = p.page_id WHERE p.page_is_redirect = 1 AND redirects.rd_from IS NULL;`,
  );
  if (present('logging')) queries.push(
    `SELECT 'log_visibility' AS metric, log_namespace, log_deleted, COUNT(*) AS log_count FROM ${t('logging')} GROUP BY log_namespace, log_deleted ORDER BY log_namespace, log_deleted;`,
    `SELECT 'orphan_log_actors' AS metric, COUNT(*) AS orphan_count FROM ${t('logging')} logs LEFT JOIN ${t('actor')} a ON a.actor_id = logs.log_actor WHERE a.actor_id IS NULL;`,
    `SELECT 'orphan_log_comments' AS metric, COUNT(*) AS orphan_count FROM ${t('logging')} logs LEFT JOIN ${t('comment')} c ON c.comment_id = logs.log_comment_id WHERE c.comment_id IS NULL;`,
  );
  if (present('log_search') && present('logging')) queries.push(`SELECT 'orphan_log_search_entries' AS metric, COUNT(*) AS orphan_count FROM ${t('log_search')} refs LEFT JOIN ${t('logging')} logs ON logs.log_id = refs.ls_log_id WHERE logs.log_id IS NULL;`);
  if (present('ipblocks_restrictions') && present('ipblocks')) queries.push(`SELECT 'orphan_block_restrictions' AS metric, COUNT(*) AS orphan_count FROM ${t('ipblocks_restrictions')} refs LEFT JOIN ${t('ipblocks')} blocks ON blocks.ipb_id = refs.ir_ipb_id WHERE blocks.ipb_id IS NULL;`);
  if (present('watchlist_expiry') && present('watchlist')) queries.push(`SELECT 'orphan_watchlist_expiries' AS metric, COUNT(*) AS orphan_count FROM ${t('watchlist_expiry')} refs LEFT JOIN ${t('watchlist')} watches ON watches.wl_id = refs.we_item WHERE watches.wl_id IS NULL;`);
  if (present('job')) queries.push(`SELECT 'quarantined_job_summary' AS metric, SHA2(job_cmd, 256) AS command_digest, job_attempts, COUNT(*) AS job_count, MIN(job_timestamp) AS oldest, MAX(job_timestamp) AS newest FROM ${t('job')} GROUP BY job_cmd, job_attempts ORDER BY command_digest, job_attempts;`);
  if (present('objectcache')) queries.push(`SELECT 'local_cache_summary' AS metric, COUNT(*) AS cache_entries, SUM(OCTET_LENGTH(value)) AS stored_bytes, MIN(exptime) AS earliest_expiry, MAX(exptime) AS latest_expiry FROM ${t('objectcache')};`);
  queries.push('-- Counts/digests preserve database evidence, not filesystem bytes, ExternalStore backing content, shared auth, Redis/Memcached queues, search indexes or extension behavior. Inventory those from source configuration and host backups.');
  queries.push('-- Compare any preexisting orphan/mismatch values with the untouched backup baseline before interpreting them. Do not run jobs or regenerate derived tables during equivalence checks.');
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
