import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { verifyTraceSignature } from './hmac';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const TRACE_HMAC_SECRET = process.env.TRACE_HMAC_SECRET || '';
const TRACE_SKILL_ID = process.env.TRACE_SKILL_ID || '';
const BRAIN_BASE_URL = process.env.BRAIN_BASE_URL || 'https://brain.endlessriver.ai';

// Capture rawBody BEFORE JSON parsing — required for HMAC verification.
app.use(
  express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  })
);

// ─── 🟢 Webhook Endpoint ──────────────────────────────────────────────────────
// media.photo, media.audio, media.video events arrive here.
// Always: return 202 immediately, then process asynchronously and POST to callback_url.
app.post('/webhook', verifyTraceSignature(TRACE_HMAC_SECRET), async (req: Request, res: Response) => {
  const { event, user, request_id, callback_url } = req.body;
  console.log(`[Webhook] Received ${event.channel} for user ${user.id}`);

  // Acknowledge immediately — never keep the platform waiting.
  res.status(202).json({ status: 'accepted' });

  // Process asynchronously, then call back with results.
  processEvent({ event, user, requestId: request_id, callbackUrl: callback_url })
    .catch((err) => console.error('[Webhook] processing error:', err));
});

async function processEvent(opts: {
  event: any;
  user: any;
  requestId: string;
  callbackUrl: string;
}) {
  const { event, user, requestId, callbackUrl } = opts;

  // TODO: add your processing logic here (vision, audio, etc.)
  // Then POST the results to callbackUrl.

  const responses = [
    {
      type: 'notification',
      content: {
        title: 'Template Skill',
        body: `Processed your ${event.channel} event.`,
      },
    },
  ];

  await postCallback(callbackUrl, requestId, responses);
}

// ─── 🔵 MCP (JSON-RPC) Endpoint ──────────────────────────────────────────────
// Used for dialog turns (voice queries).
app.post('/mcp', async (req: Request, res: Response) => {
  const { jsonrpc, method, params, id } = req.body;
  if (jsonrpc !== '2.0') return res.status(400).send('Invalid JSON-RPC');

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'handle_dialog',
            description: 'My main dialog tool.',
            inputSchema: {
              type: 'object',
              properties: {
                utterance: { type: 'string' }
              }
            }
          }
        ]
      }
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    if (name === 'handle_dialog') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            { type: 'text', text: `You said: ${args.utterance}` },
            {
              type: 'embedded_responses',
              responses: [
                { type: 'feed_item', content: { title: 'Dialog Handled', story: args.utterance } }
              ]
            }
          ]
        }
      });
    }
  }

  res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

// ─── Callback helper ─────────────────────────────────────────────────────────
// Sign and POST the skill's response back to the platform after async processing.

async function postCallback(callbackUrl: string, requestId: string, responses: any[]) {
  const body      = JSON.stringify({ request_id: requestId, status: 'success', responses });
  const timestamp = Date.now().toString();
  const signature = 'sha256=' + crypto
    .createHmac('sha256', TRACE_HMAC_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Trace-Timestamp': timestamp,
      'X-Trace-Signature': signature,
    },
    body,
  });
  console.log(`[Callback] → ${res.status}`);
}

// ─── 🟣 Proactive Push API Helper ───────────────────────────────────────────
// Use this to send responses on your own schedule (cron, job queue, etc.)
// without a triggering event from the platform.

// Use user_id from installedUsers (populated via POST /install) — not from webhook dispatches.
async function sendPushResponse(user_id: string, responses: any[]) {
  const url = `${BRAIN_BASE_URL}/api/skill-push/${TRACE_SKILL_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TRACE_HMAC_SECRET}`,
    },
    body: JSON.stringify({ user_id, responses }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[Push] ${res.status} ${text}`);
  }
}

// ─── 🟡 Install Webhook ───────────────────────────────────────────────────────
// Platform POSTs here (HMAC-signed) when a user installs or uninstalls.
// Register proxyUserIds here — required for proactive push (see sendPushResponse).

const installedUsers = new Map<string, {
  timezone?: string;
  locale?: string;
  first_name?: string;
  last_name?: string;
  installed_at?: string;
}>();

app.post('/install', verifyTraceSignature(TRACE_HMAC_SECRET), (req: Request, res: Response) => {
  const { event, skill_id, user, installed_at } = req.body;

  if (!user?.id) {
    return res.status(400).json({ error: 'Missing user.id' });
  }

  console.log(`[Install] ${event} user=${user.id} skill=${skill_id}`);

  if (event === 'install') {
    installedUsers.set(user.id, {
      timezone: user.timezone,
      locale: user.locale,
      first_name: user.first_name,
      last_name: user.last_name,
      installed_at,
    });
  } else if (event === 'uninstall') {
    installedUsers.delete(user.id);
    // TODO: cancel pending jobs/reminders for user.id
  } else {
    return res.status(400).json({ error: `Unknown event: ${event}` });
  }

  res.json({ ok: true });
});

// ─── Lifecycle / Deletion ────────────────────────────────────────────────────
app.post('/delete-user', (req: Request, res: Response) => {
  const { user_id } = req.body;
  console.log(`[Cleanup] Deleting data for user ${user_id}`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Skill template running at http://localhost:${PORT}`);
});
