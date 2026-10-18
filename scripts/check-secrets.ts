import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'dotenv';

// Prints paths/counts only; never prints credentials or matching source lines.
const root = process.cwd();
let temporary: string | undefined;
let git = ['-C', root];
try {
  let top = '';
  try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (resolve(top || '/') !== resolve(root)) {
    temporary = mkdtempSync(join(tmpdir(), 'aom-git-check-'));
    execFileSync('git', ['init', '--quiet', temporary], { stdio: 'ignore' });
    git = [`--git-dir=${join(temporary, '.git')}`, `--work-tree=${root}`];
  }
  const source = execFileSync('git', [...git, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).split('\0').filter(Boolean);
  const probes = ['.env', '.env.local', '.env.production', '.env.deploy-market', '.env.deploy-facilitator', '.aom/deployments.json', '.mcp-use/cloud/link.json', 'data/aom.sqlite'];
  const ignored = execFileSync('git', [...git, 'check-ignore', '--no-index', '--stdin', '-z'], { input: probes.join('\0') + '\0', encoding: 'utf8' }).split('\0');
  const failures: string[] = probes.filter(p => !ignored.includes(p)).map(p => `Not ignored: ${p}`);
  for (const path of source) if (path.split('/').at(-1)?.startsWith('.env') && path !== '.env.example') failures.push(`Credential file would be published: ${path}`);
  const values: Record<string, string> = {};
  for (const path of ['.env', '.env.local']) if (existsSync(path)) Object.assign(values, parse(readFileSync(path)));
  const secrets = Object.entries(values).filter(([k, v]) => /KEY|SECRET|TOKEN|IMESSAGE_TO/.test(k) && v.length >= 10).map(([, v]) => v);
  const build: string[] = [];
  function walk(path: string) { for (const entry of readdirSync(path, { withFileTypes: true })) { const next = join(path, entry.name); if (entry.isDirectory()) walk(next); else if (entry.isFile()) build.push(relative(root, next)); } }
  if (existsSync('.mcp-use/build')) walk(resolve('.mcp-use/build'));
  for (const path of new Set([...source, ...build])) {
    const absolute = resolve(path);
    if (!existsSync(absolute)) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    if (secrets.some(value => text.includes(value))) failures.push(`Configured credential found in publishable source/build: ${path}`);
    if (/(?:(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]{24,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|ApiKey_[A-Za-z0-9_-]{24,})/.test(text)) failures.push(`Possible literal API key: ${path}`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`PASS: ${source.length} publishable files and ${build.length} build files scanned; no configured secrets found.`);
  console.log('PASS: .env files, generated deployment environments, local database and deployment metadata are excluded. Only .env.example may be published.');
  console.log(temporary ? 'No repository has been initialized here; verified future Git exclusions with an isolated temporary Git index.' : 'Verified tracked and untracked files in the current Git repository.');
} finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
