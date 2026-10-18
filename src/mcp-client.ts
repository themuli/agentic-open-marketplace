import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export async function connectMarket() {
  const url = process.env.MARKET_MCP_URL || 'http://127.0.0.1:3000/mcp';
  const client = new Client({ name: 'aom-facilitator-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { 'x-aom-agent-key': process.env.AOM_AGENT_SECRET || '' } },
  });
  await client.connect(transport);
  return client;
}
export function toolData(result: { isError?: boolean; structuredContent?: unknown; content?: unknown[] }): unknown {
  if (result.isError) throw new Error(JSON.stringify(result.content));
  const data = result.structuredContent;
  return data && typeof data === 'object' && 'data' in data ? data.data : data;
}
