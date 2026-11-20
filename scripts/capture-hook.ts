import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { captureSchema, hasSensitiveContent } from '../src/memory';

// Generic host-hook adapter. The host must map its own event format to the
// documented sanitized payload; this does not read transcripts or install hooks.
const url = process.env.STICK_URL;
if (!url) throw new Error('Set STICK_URL to your private MCP link in the hook environment.');
let body = '';
for await (const chunk of process.stdin) { body += chunk; if (body.length > 40_000) throw new Error('Hook payload exceeds 40KB. Send a concise redacted summary.'); }
if (hasSensitiveContent(body)) { console.log(JSON.stringify({ saved: false, reason: 'Possible sensitive content detected; redact first.' })); }
else {
  const input = JSON.parse(body);
  const payload = captureSchema.parse({ ...input, extract_with_ai: input.extract_with_ai ?? !input.insights });
  const client = new Client({ name: 'stick-capture-hook', version: '3.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const result = await client.callTool({ name: 'capture_interaction', arguments: payload });
    console.log((result.content as Array<{ text: string }>)[0].text);
    if (result.isError) process.exitCode = 1;
  } finally { await client.close(); }
}
