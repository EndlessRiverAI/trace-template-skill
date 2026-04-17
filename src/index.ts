import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { verifyTraceSignature } from './hmac';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
// Configuration
const PORT = process.env.PORT || 3000;
const TRACE_HMAC_SECRET = process.env.TRACE_HMAC_SECRET || '';
const TRACE_SKILL_ID = process.env.TRACE_SKILL_ID || '';
const BRAIN_BASE_URL = process.env.BRAIN_BASE_URL || 'https://brain.endlessriver.ai';

app.use(bodyParser.json());

// ─── 🟢 Webhook Endpoint ──────────────────────────────────────────────────────
// Used for processing background events like photos or audio.
app.post('/webhook', verifyTraceSignature(TRACE_HMAC_SECRET), async (req: Request, res: Response) => {
  const { event, user, request_id } = req.body;
  console.log(`[Webhook] Received ${event.channel} for user ${user.id}`);

  // Example: Respond immediately (Sync)
  res.status(200).json({
    status: 'success',
    responses: [
      {
        type: 'notification',
        content: {
          title: 'Hello from Template!',
          body: `I received your ${event.channel} event.`
        }
      }
    ]
  });

  // Example: Respond later (Async/Push) via Brain Push API
  // Helpful for long-running tasks like video processing.
  /*
  setTimeout(() => {
    sendPushResponse(user.id, [
      {
        type: 'notification',
        content: {
          title: 'Processed!',
          body: `Background task finished for your ${event.channel} event.`
        }
      }
    ]);
  }, 2000);
  */
});

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

// ─── 🟣 Brain Push API Helper ───────────────────────────────────────────────

/**
 * Helper to send an out-of-band "push" response to the Brain.
 * Useful for long-running tasks, background updates, or scheduled jobs.
 */
async function sendPushResponse(user_id: string, responses: any[]) {
  const url = `${BRAIN_BASE_URL}/api/skill-push/${TRACE_SKILL_ID}`;
  
  try {
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
      console.error(`[Push] Failed to push response: ${res.status} ${text}`);
    } else {
      console.log(`[Push] Successfully pushed response for user ${user_id}`);
    }
  } catch (err) {
    console.error(`[Push] Error during push:`, err);
  }
}

// ─── Lifecycle / Deletion ────────────────────────────────────────────────────
app.post('/delete-user', (req: Request, res: Response) => {
  const { user_id } = req.body;
  console.log(`[Cleanup] Deleting data for user ${user_id}`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Skill template running at http://localhost:${PORT}`);
});
