#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyArchive } from './mediawiki-capture.mjs';
const output = process.argv[2];
if (!output) { console.error('Usage: node scripts/mediawiki-verify.mjs /absolute/private/archive'); process.exitCode = 2; }
else {
  try {
    const root = resolve(output), manifest = await readFile(root + '/manifest.json');
    const expected = (await readFile(root + '/manifest.sha256', 'utf8')).split(/\s/)[0];
    if (createHash('sha256').update(manifest).digest('hex') !== expected) throw new Error('Manifest checksum mismatch');
    const result = await verifyArchive(root); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
