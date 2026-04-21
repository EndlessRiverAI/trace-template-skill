# Trace Skill Engineering Context (for LLMs)

You are an expert software engineer building a **Trace Skill** — a standalone web service that connects to the Trace AI glasses platform. This document is the complete reference for the platform contract. Follow it precisely.

A Skill receives events from glasses and the phone app (photos, voice, text, images), processes them, and responds with actions (notifications, reminders, emails, follow-up questions, etc.).

---

## 1. Architecture Overview

Trace Skills communicate via two interfaces. Most production skills are **Hybrid** (both).

| Interface | Use case | Execution model |
|---|---|---|
| **Webhook** | Background media processing (photos, audio) | Async: return `202`, process, POST callback |
| **MCP** | Interactive dialog — voice, text, phone image | Sync: return result in the JSON-RPC response |

### Skill Interface Types
- `webhook` — only processes media events
- `mcp` — only handles dialog
- `hybrid` — both; active `interaction.dialog` events go to MCP, `media.*` events go to webhook

### File Structure
```
my-skill/
├── src/
│   ├── index.ts        # Express server
│   ├── hmac.ts         # Signature verification middleware
│   └── agents.ts       # AI / LLM logic
├── manifest.json
├── .env                # HMAC_SECRET, API keys
└── package.json
```

---

## 2. Security: HMAC Verification

**Every** request from Trace is signed. You must verify it before processing.

Headers sent by Trace:
- `X-Trace-Signature: sha256=<hex>`
- `X-Trace-Timestamp: <unix_ms>`

Verification:
```typescript
import crypto from 'crypto';

function verifyHmac(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Use `express.raw({ type: 'application/json' })` before JSON parsing so `rawBody` is available.

---

## 3. Channel Taxonomy & Triggers

### Channels

| Channel | Source | Semantics |
|---|---|---|
| `media.photo` | Glasses | Photo captured and synced |
| `media.video` | Glasses, Phone | Video captured and synced |
| `media.audio` | Glasses | Audio recording captured and synced |
| `interaction.dialog` | Glasses, Phone | Real-time user interaction — voice, text, or image+query |

**Phone mode rule:** All phone inputs (image, voice, text) go to `interaction.dialog`. Phone video is the only exception — it goes to `media.video`.

### Trigger Configuration (in Developer Console)
```json
{
  "triggers": [
    { "channel": "media.photo", "routing_mode": "passive" },
    { "channel": "interaction.dialog", "routing_mode": "active" }
  ]
}
```

`routing_mode`:
- `active` — platform selects your skill to handle this event; response is surfaced to the user
- `passive` — background fire-and-forget; response goes to activity feed only

### Trigger Filters for `interaction.dialog`

You can narrow when your skill fires:

```json
{ "channel": "interaction.dialog", "filter": { "hasImage": true } }
{ "channel": "interaction.dialog", "filter": { "hasQuery": true } }
{ "channel": "interaction.dialog", "filter": { "source": "phone_image" } }
{ "channel": "interaction.dialog", "filter": { "source": ["phone_image", "phone_image_text", "phone_voice_image"] } }
// Match any image input including back-references (source: "ai_agent"):
{ "channel": "interaction.dialog", "filter": { "hasImage": true } }
```

Supported filter keys:
- `hasImage: true` — only when user shares an image
- `hasQuery: true` — only when there is voice/text (non-image-only)
- `source: string | string[]` — specific input source(s)

---

## 4. interaction.dialog Payload

Every `interaction.dialog` event has a normalized payload. The platform pre-processes images (vision description) before dispatching.

**Webhook/MCP `event` object fields for `interaction.dialog`:**

```json
{
  "channel": "interaction.dialog",
  "source": "phone_voice_image",
  "query": "what's the calorie count?",
  "items": [
    {
      "id": "item_abc",
      "url": "https://s3.trace.ai/presigned/...",
      "mimeType": "image/jpeg",
      "imageDescription": "A plate with grilled chicken and rice, approximately 400g total."
    }
  ]
}
```

**`source` values:**

| Value | Meaning | query? | items? |
|---|---|---|---|
| `glasses_voice` | Voice from glasses (may include image capture — see below) | ✓ | ✓ image* |
| `phone_voice` | Voice from phone AI dialog | ✓ | — |
| `phone_text` | Typed text in phone chat | ✓ | — |
| `phone_image` | Photo from phone, no text | — | ✓ image |
| `phone_image_text` | Photo + typed text from phone chat | ✓ | ✓ image |
| `phone_voice_image` | Voice + photo simultaneously from phone | ✓ | ✓ image |
| `ai_agent` | Back-reference: user refers to a previously captured image ("save that", "add that receipt") | ✓ | ✓ image† |

**† Multi-turn back-reference (`ai_agent`):** When a user captures an image earlier in a session and later refers to it by pronoun or context ("save that", "log that image"), the platform resolves the prior image from session memory (up to 5 recent captures, 12-hour window) and dispatches on `interaction.dialog` with `source: "ai_agent"`. The `items[0]` contains the original image URL and its pre-analysis description. Your skill **must** have an `interaction.dialog` trigger to receive back-reference events — `media.photo` alone is not sufficient. Use `{ "hasImage": true }` as a filter to match both direct image inputs and back-references.

**Key fields:**
- `event.query` — the user's text or voice transcript (empty string if image-only)
- `event.items[0].url` — the image URL (if hasImage)
- `event.items[0].imageDescription` — GPT-4o vision pre-analysis (brief, for routing context)
- `pending_context` — injected at top level when this event answers a prior AWAIT_INPUT (see §7)

---

## 5. Webhook Specification

**Endpoint:** `POST /webhook`

### Async Pattern (required for media.*)
1. Validate HMAC signature
2. Return `202 Accepted` immediately
3. Process asynchronously
4. POST result to `body.callback_url`

### Request Payload Shape

```json
{
  "request_id": "uuid-abc",
  "callback_url": "https://api.trace.ai/skill-callback/...",
  "user": {
    "id": "proxied_user_id",
    "timezone": "Asia/Kolkata",
    "locale": "en-IN",
    "name": "Ishaan",
    "location": { "country": "IN", "city": "Delhi", "latitude": 28.61, "longitude": 77.20 }
  },
  "device": {
    "id": "proxied_device_id",
    "model": "trace-v1.1"
  },
  "skill": {
    "id": "nutrient-tracker",
    "version": "1.0.0"
  },
  "event": {
    "channel": "media.photo",
    "source": "wifi_sync",
    "items": [
      {
        "id": "item_xyz",
        "url": "https://s3.trace.ai/presigned/...",
        "mimeType": "image/jpeg",
        "thumbnailUrl": "https://s3.trace.ai/presigned/thumb/...",
        "imageDescription": "A plate of food with rice and curry",
        "captured_at": "2026-04-19T08:30:00Z",
        "tags": ["food", "lunch"]
      }
    ]
  },
  "context": {
    "session_id": null,
    "tags": []
  },
  "granted_permissions": ["user.profile.read"],
  "granted_integrations": ["gmail"]
}
```

> `pending_context` is added at the top level when this webhook fires as a follow-up to an AWAIT_INPUT you previously sent. See §7.

### Callback Response Shape

POST to `callback_url` with HMAC-signed body:

```json
{
  "request_id": "uuid-abc",
  "status": "success",
  "responses": [
    {
      "type": "notification",
      "content": { "title": "Meal Logged", "body": "500 kcal — chicken and rice" }
    },
    {
      "type": "feed_item",
      "content": { "feed_type": "skill", "title": "Logged 500 kcal lunch" }
    }
  ]
}
```

Sign the callback just like incoming requests: `sha256=hmac(secret, timestamp + "." + body)`.

### Sync Response (200) for `interaction.dialog`

For `interaction.dialog` events dispatched to a webhook (pending-context follow-ups for WEBHOOK-only skills), return 200 with the same `responses` array shape — no `request_id` or `status` wrapper needed, just the `responses` key.

---

## 6. MCP Specification (JSON-RPC 2.0)

**Endpoint:** `POST /mcp`

Trace calls `tools/list` on connect, then `tools/call` with the matched tool. The preferred entry tool name is `handle_dialog` (also accepted: `dialog`, `chat`, `ask`, `handle`).

### Tool Input Shape (`tools/call`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "handle_dialog",
    "arguments": {
      "utterance": "what did I eat today?",
      "userId": "proxied_user_id",
      "deviceId": "proxied_device_id",
      "session_id": "uuid-session",
      "turn_index": 0,
      "context": {
        "source": "phone_voice",
        "query": "what did I eat today?",
        "hasImage": false,
        "imageDescription": null
      },
      "items": [],
      "user": {
        "id": "proxied_user_id",
        "timezone": "Asia/Kolkata",
        "locale": "en-IN",
        "name": "Ishaan",
        "location": { ... }
      },
      "pending_context": null
    }
  }
}
```

When the user sends a phone food photo (`phone_image`):
- `utterance` is `""` or the user's voice query
- `items` contains the image: `[{ "id": "...", "url": "...", "mimeType": "image/jpeg", "imageDescription": "..." }]`
- `context.hasImage` is `true`

When answering a previous AWAIT_INPUT:
- `pending_context` is populated — see §7

### MCP Response Shape

```json
{
  "content": [
    { "type": "text", "text": "You've had 1,200 kcal today across 3 meals." },
    {
      "type": "embedded_responses",
      "responses": [
        { "type": "notification", "content": { "title": "Today: 1,200 kcal", "body": "..." } },
        { "type": "set_reminder", "content": { "reminderText": "Log dinner", "time": "2026-04-19T19:00:00Z" } }
      ]
    }
  ]
}
```

The `text` content is spoken via TTS on the glasses. `embedded_responses` deliver side-effects (notifications, reminders, tool calls, AWAIT_INPUT).

### Multi-turn Sessions

Return `state: 'awaiting_input'` to keep a voice session open:
```json
{ "content": [...], "state": "awaiting_input" }
```
Default is `state: 'completed'`. Use `state: 'error'` to clear the session on failure.

---

## 7. AWAIT_INPUT — Cross-Dispatch Follow-up

`AWAIT_INPUT` lets a skill ask the user a question and receive the answer in a subsequent `interaction.dialog` event, with the original context preserved. This works across separate dispatch events — e.g., a `media.photo` webhook can ask a follow-up that the user answers via voice.

### When to use it
- Photo analyzed but food not detected → ask what the user ate
- Low-confidence analysis → ask for confirmation/correction
- Media processed → need clarification before acting

### AWAIT_INPUT Response

Return from webhook callback (inside `responses`) or MCP `embedded_responses`:

```json
{
  "type": "await_input",
  "content": {
    "question": "I didn't spot food in that photo — what did you eat?",
    "context_key": "no_food_found",
    "context_payload": {
      "image_url": "https://...",
      "captured_at": "2026-04-19T08:30:00Z"
    },
    "allow_image": false,
    "timeout_ms": 300000
  }
}
```

| Field | Required | Description |
|---|---|---|
| `question` | Yes | Shown to user as a prompt on glasses/phone |
| `context_key` | No | Your own identifier for the pending state (auto-generated if omitted) |
| `context_payload` | No | Arbitrary JSON to persist — injected back on the follow-up dispatch (max 50 KB) |
| `allow_image` | No | If `true`, UI offers camera for the response |
| `timeout_ms` | No | Default 300s, max 600s |

**Limits:** max 3 active pending contexts per user, max 10 chained follow-up turns per skill.

### What the skill receives on the follow-up

The user's answer arrives as a normal `interaction.dialog` event. The platform injects `pending_context` at the top level:

**Webhook payload:**
```json
{
  "event": {
    "channel": "interaction.dialog",
    "source": "phone_voice",
    "query": "I had grilled chicken and rice",
    "items": []
  },
  "pending_context": {
    "context_key": "no_food_found",
    "context_payload": { "image_url": "...", "captured_at": "..." },
    "question": "I didn't spot food in that photo — what did you eat?",
    "turn_count": 1
  },
  "user": { ... }
}
```

**MCP toolInput:**
```json
{
  "utterance": "I had grilled chicken and rice",
  "pending_context": {
    "context_key": "no_food_found",
    "context_payload": { "image_url": "...", "captured_at": "..." },
    "question": "I didn't spot food in that photo — what did you eat?",
    "turn_count": 1
  }
}
```

The user's text is in `event.query` (webhook) or `utterance` (MCP). If the user responded with an image (`allow_image: true`), it's in `event.items[0]`.

### Routing note for Hybrid skills

For a **Hybrid** skill, all `interaction.dialog` events (including pending-context follow-ups) are routed to the MCP `handle_dialog` tool. Only **Webhook-only** skills receive pending-context follow-ups at the webhook endpoint.

### Chaining follow-ups

Return another `AWAIT_INPUT` from the follow-up response to ask another question:
```
Turn 1: media.photo → no food → AWAIT_INPUT "What did you eat?"
Turn 2: interaction.dialog "chicken salad" → log meal → AWAIT_INPUT "Any calorie target for today?"
Turn 3: interaction.dialog "2000 kcal" → set goal → NOTIFICATION "Goal set: 2,000 kcal"
```

---

## 8. Response Types Reference

All responses use the same shape whether in a webhook callback or MCP `embedded_responses`:
```json
{ "type": "<type>", "content": { ... } }
```

### notification
```json
{
  "type": "notification",
  "content": {
    "title": "Meal Logged",
    "body": "Chicken and rice — 550 kcal",
    "tts": "Five hundred fifty calories logged.",
    "persist": true
  }
}
```

### feed_item
```json
{
  "type": "feed_item",
  "content": { "feed_type": "skill", "title": "Logged 550 kcal lunch", "story": "..." }
}
```

### set_reminder
```json
{
  "type": "set_reminder",
  "content": { "reminderText": "Log dinner", "time": "2026-04-19T19:00:00Z" }
}
```

### set_todo
```json
{
  "type": "set_todo",
  "content": { "title": "Review meeting notes", "priority": "HIGH" }
}
```

### confirm_action
Platform shows a Yes/No prompt before executing the action.
```json
{
  "type": "confirm_action",
  "content": {
    "prompt": "Post this photo to Slack?",
    "on_confirm": { "type": "integration_action", ... },
    "on_decline": { "type": "notification", "content": { "title": "Cancelled" } },
    "timeout_ms": 30000
  }
}
```

### tool_call (Zero-OAuth)
Use the user's own connected accounts without ever seeing a token.
```json
{
  "type": "tool_call",
  "content": {
    "tool": "mail.send",
    "params": { "subject": "Meeting notes", "body": "...", "html": "..." },
    "on_result": "notify_user",
    "success_message": "Notes sent to your email."
  }
}
```

Available tools: `mail.send` · `calendar.create`

### await_input
See §7 above.

---

## 9. User Context & Permissions

Declare permissions in the Developer Console. Data is injected only if the user grants access.

```json
"user": {
  "id": "proxied_user_id",
  "timezone": "Asia/Kolkata",
  "locale": "en-IN",
  "name": "Ishaan",
  "location": {
    "country": "IN",
    "city": "Delhi",
    "latitude": 28.6139,
    "longitude": 77.2090
  }
}
```

| Permission | Fields unlocked |
|---|---|
| *(always)* | `id`, `timezone`, `locale` |
| `user.profile.read` | `name` |
| `user.location.read` | `location` |

**Always use `user.id` (proxy) as your DB primary key.** Never store or log it externally — treat it as an opaque stable identifier.

---

## 10. Agentic Patterns

### A. Persistence
Skills are stateless. Use a database keyed on `user.id`.
- **Recommended for hackathons:** SQLite via `better-sqlite3`
- **Production:** Postgres, MongoDB, Redis

### B. Proactive Push / Scheduling
To send a notification without a triggering event (daily summary, scheduled reminder):
```http
POST /api/skill-push/:skillId
Authorization: Bearer <HMAC_SECRET>
Content-Type: application/json

{
  "userId": "proxied_user_id",
  "responses": [
    { "type": "notification", "content": { "title": "Daily Report", "body": "..." } }
  ]
}
```

Use `node-cron` or a job queue to trigger this on a schedule. Store `user.id` + `callback_url` from the first event dispatch.

### C. Vision / Multimodal
When receiving a photo (webhook `media.photo` or MCP phone image):
1. Download from `items[0].url` (presigned, expires in ~15 minutes — process promptly)
2. Run through a vision LLM (Gemini `gemini-2.0-flash`, GPT-4o)
3. Extract structured data, store result

`items[0].imageDescription` is a brief GPT-4o description already attached by the platform (useful for routing context, not detailed enough for analysis). Run your own vision call for full analysis.

---

## 11. Development Workflow

1. **Local testing:** expose with `ngrok`. Set the ngrok URL in the Developer Console.
2. **Deployment:** Railway, Render, or any VPS. Ensure the endpoint is publicly accessible.
3. **Validate payloads:** log `req.body` on first run to understand the exact shape for your channel.
4. **HMAC in dev:** temporarily log the expected vs received signature if verification fails — check that you're using `rawBody`, not the parsed JSON.

---

## 12. LLM Counselor Guidelines

When helping a developer build a Trace Skill:

1. **Start with the manifest** — define channels, routing_mode, and domains first.
2. **Security is non-negotiable** — always include HMAC verification in the first draft.
3. **Pick the right interface** — background processing → webhook; voice dialog → MCP; both → hybrid.
4. **Async by default for media** — always `202 → callback` for `media.*` channels.
5. **Use AWAIT_INPUT instead of state hacks** — if a skill needs clarification before acting, return `await_input`. Don't try to manage conversation state manually.
6. **Items, not payload** — media URLs are in `event.items[0].url`, not `event.payload.url` or `event.url`.
7. **Proxy IDs only** — `user.id` is a proxy. Use it as DB key. Never expose or log real user identifiers.
8. **`context_payload` for follow-ups** — store all state the skill needs in `context_payload` when returning `await_input`. Don't rely on in-memory state across dispatch events.
9. **Hybrid skills: MCP gets all dialog** — for hybrid skills, all `interaction.dialog` events (including pending-context follow-ups) route to MCP. Check `pending_context` in `toolInput` before running intent classification.
10. **Handle `items` in MCP** — for phone food photos or any `interaction.dialog` with `hasImage: true`, inspect `toolInput.items` for image URLs and process them with vision.
11. **`interaction.dialog` trigger required for back-references** — if a skill should respond when users say "save that" or "add that image" after capturing a photo, it **must** declare an `interaction.dialog` trigger (active routing). A `media.photo`-only skill will never receive back-reference dispatches. Use `{ "hasImage": true }` as the filter to match both direct image inputs and back-references in one trigger.
12. **`phone_image_text` vs `phone_image`** — `phone_image_text` is sent when the user attaches an image AND types a text query in the phone chat. `phone_image` is photo-only with no text. If your skill needs either, filter on `{ "source": ["phone_image", "phone_image_text"] }` or simply `{ "hasImage": true }`.
