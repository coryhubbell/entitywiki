import { copyFile, chmod, access, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureToolEnvironment } from './tool-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
configureToolEnvironment(root);
const config = new URL('../dist/server/wrangler.json', import.meta.url);
await access(config).catch(() => { throw new Error('Run npm run build before starting the local runtime.'); });
const generatedVars = new URL('../dist/server/.dev.vars', import.meta.url);
let copied = false;
try {
  await access(new URL('../.dev.vars', import.meta.url));
  // Wrangler resolves Worker bindings beside its generated config, not --env-file.
  await copyFile(new URL('../.dev.vars', import.meta.url), generatedVars);
  await chmod(generatedVars, 0o600);
  copied = true;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = process.argv[2] ?? '8876';
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error('Supply a valid local port.');
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'dev', '--config', fileURLToPath(config), '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', port, '--inspector-port', '0', '--log-level', 'error'], { cwd: root, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code)); });
if (copied) await unlink(generatedVars).catch(() => {});
process.exitCode = exit ?? 1;
