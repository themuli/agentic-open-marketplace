import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
config({ path: ['.env', '.env.local'], quiet: true });
const value = (key: string) => process.env[key] || '';
const shared = { AOM_AGENT_SECRET: value('AOM_AGENT_SECRET'), AOM_ADMIN_SECRET: value('AOM_ADMIN_SECRET'), HOST: '0.0.0.0', NODE_ENV: 'production' };
if (!shared.AOM_AGENT_SECRET || !shared.AOM_ADMIN_SECRET) throw new Error('Run npm run setup first.');
const stripe = value('STRIPE_SECRET_KEY');
if (stripe && !/^(sk|rk)_test_/.test(stripe)) throw new Error('Refusing to deploy a non-test Stripe key.');
const market = { ...shared, AOM_ROLE: 'market', AOM_DB_PATH: '/tmp/aom-market.sqlite', FACILITATOR_URL: value('FACILITATOR_URL'),
  STRIPE_SECRET_KEY: stripe, ALLOW_MOCK_PAYMENTS: value('ALLOW_MOCK_PAYMENTS') || 'false', INKBOX_API_KEY: value('INKBOX_API_KEY'), INKBOX_IDENTITY: value('INKBOX_IDENTITY'), COMPANY_IMESSAGE_TO: value('COMPANY_IMESSAGE_TO') };
const facilitator = { ...shared, AOM_ROLE: 'facilitator', AOM_DB_PATH: '/tmp/aom-facilitator.sqlite', MARKET_MCP_URL: value('MARKET_MCP_URL'), OPENAI_API_KEY: value('OPENAI_API_KEY'), OPENAI_MODEL: value('OPENAI_MODEL') || 'gpt-4.1-mini' };
for (const [name, data] of [['market', market], ['facilitator', facilitator]] as const) {
  if (Object.values(data).some(v => /[\r\n]/.test(v))) throw new Error('Environment values must be single-line.');
  writeFileSync(`.env.deploy-${name}`, Object.entries(data).filter(([, v]) => !!v).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}
console.log('Prepared ignored .env.deploy-market and .env.deploy-facilitator. Secret values were not printed.');
