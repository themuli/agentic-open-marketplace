import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env.local')) {
  writeFileSync('.env.local', `AOM_AGENT_SECRET=${randomBytes(32).toString('hex')}\nAOM_ADMIN_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.log('Created .env.local with generated agent and reset secrets. Values were not printed.');
}
if (!existsSync('.env')) { writeFileSync('.env', '', { mode: 0o600 }); console.log('Created .env. Add integration credentials there.'); }
