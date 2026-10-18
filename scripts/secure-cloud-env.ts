import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

export function secureCloudEnvironment(role: string, serverId: string) {
  const values = parse(readFileSync(`.env.deploy-${role}`));
  const ordinary: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/KEY|SECRET|TOKEN|IMESSAGE_TO/.test(key)) { ordinary[key] = value; continue; }
    // No shell interpolation; suppress raw child errors, which could contain spawn arguments.
    try {
      const raw = execFileSync(process.execPath, ['node_modules/mcp-use/dist/bin.js', 'servers', 'env', 'set', serverId, `${key}=${value}`, '--secret', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      if (JSON.parse(raw).secret !== true) throw new Error('Secret storage not confirmed');
    } catch { throw new Error(`Could not confirm write-only storage for ${role}/${key}. No credential value was logged.`); }
    console.log(`Stored ${role}/${key} as a write-only cloud secret.`);
  }
  const file = `.env.deploy-${role}-public`;
  writeFileSync(file, Object.entries(ordinary).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  return file;
}
