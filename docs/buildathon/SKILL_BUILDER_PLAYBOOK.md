# 🚀 Trace Skill Builder Playbook

Welcome to the Trace Buildathon! This guide will help you go from zero to a fully functional AI-powered skill in minutes.

---

## 📑 Table of Contents
1. [What is a Trace Skill?](#1-what-is-a-trace-skill)
2. [Prerequisites](#2-prerequisites)
3. [The 10-Minute Quickstart](#3-the-10-minute-quickstart)
4. [Choosing Your Interface](#4-choosing-your-interface)
5. [The Power of Platform Actions](#5-the-power-of-platform-actions)
6. [Personalization & User Data](#6-personalization--user-data)
7. [Security: HMAC & Proxy IDs](#7-security-hmac--proxy-ids)
8. [Deployment Guide](#8-deployment-guide)
9. [Example Ideas](#9-example-ideas)

---

## 1. What is a Trace Skill?
Trace glasses capture the world through **media** (audio, photos) and **intent** (voice commands). A skill is a standalone web service that:
1. **Subscribes** to these events via triggers.
2. **Processes** the data (usually with an LLM like Gemini).
3. **Responds** with actions like notifications, calendar events, or multi-turn dialog.

> [!IMPORTANT]
> **Privacy First**: Skills never receive raw user IDs or hardware access. All user IDs are proxied, and permissions (like location) must be explicitly granted by the user.

---

## 2. Prerequisites
Before you start, ensure you have:
- **Node.js** (v18+) and **npm/yarn**.
- **ngrok** (to expose your local server to the internet).
- **Gemini API Key** (for processing transcripts/images).
- **A Trace Developer Account** (to register your skill).

---

## 3. The 10-Minute Quickstart

### Step A: Clone the Template
```bash
cp -r docs/examples/template-skill my-skill
cd my-skill
npm install
cp .env.example .env
```

### Step B: Start your Server & Ngrok
```bash
npm run dev
# In a new terminal:
ngrok http 3000
```
*Copy the `https` URL from ngrok.*

### Step C: Register your Skill
1. Go to the **Trace Developer Dashboard** → **Skills**.
2. Click **Create New Skill**.
3. Set **Interface** to `Hybrid`.
4. Paste your ngrok URL into the **Webhook** and **MCP** endpoints.
5. Add a trigger for `interaction.dialog`.
6. **Save**. Copy the **HMAC Secret** into your `.env`.

---

## 4. Choosing Your Interface

### 🟢 Webhook (Event-Driven)
Best for processing photos or audio in the background.
- **Trigger**: `media.photo`, `media.audio`.
- **Flow**: Platform POSTs data → Skill processes → Skill returns actions.

### 🔵 MCP (Dialog-Native)
Best for building voice assistants and interactive tools.
- **Trigger**: `interaction.dialog`.
- **Flow**: User speaks → Platform calls your `handle_dialog` tool → Skill responds with text or actions.

### 🟣 Hybrid (The Pro Choice)
Use both! Webhooks for background processing and MCP for querying that data later via voice.

---

## 5. The Power of Platform Actions
Your skill doesn't just "talk" — it **does**. Return these actions in your response array:

### 💬 Notifications
```json
{
  "type": "notification",
  "content": {
    "title": "Drink Water!",
    "body": "It's been 2 hours since your last sip.",
    "persist": true
  }
}
```

### 🗓️ Agenda (Reminders & Todos)
```json
{
  "type": "set_reminder",
  "content": {
    "reminderText": "Pick up dry cleaning",
    "time": "2026-03-30T17:00:00Z"
  }
}
```

### 📧 Platform Tools (Zero-OAuth)
Send emails or create calendar events using the user's *own* accounts without handling tokens.
```json
{
  "type": "tool_call",
  "content": {
    "tool": "mail.send",
    "params": { 
      "subject": "Your Daily Recap", 
      "body": "Here is what happened today..." 
    }
  }
}
```
*Requires `mail.send` in your manifest's `allowedTools`.*

---

## 6. Personalization & User Data
To build context-aware skills, you can request access to the user's profile and location. 

### Requesting Permissions
Add these to your `manifest.json`:
```json
"permissions": [
  "user.profile.read",
  "user.location.read"
]
```

### What you get in the Payload
When these are granted, your `user` object in Webhook/MCP calls will include:
```json
"user": {
  "id": "proxied_id_...",
  "locale": "en-US",
  "timezone": "America/New_York",
  "name": "Alex Smith",
  "location": {
    "city": "Brooklyn",
    "country": "USA",
    "latitude": 40.6782,
    "longitude": -73.9442
  }
}
```
*Note: Timezone and Locale are always provided.*

---

## 7. Security: HMAC & Proxy IDs

### HMAC Verification
Every request from Trace is signed. You **must** verify it to ensure the request is legitimate.
```typescript
const signature = req.headers['x-trace-signature'];
const timestamp = req.headers['x-trace-timestamp'];
// Verify using your HMAC Secret... (See template-skill for code)
```

### Proxy IDs
If you need to store data for a user, use the `user.id` provided in the payload. It is a stable, unique proxy ID for that specific user + your skill. It remains the same for that user forever but is different for other skills.

---

## 8. Deployment Guide
When you're ready to go live for the judges:

### Option 1: Railway (Recommended)
1. Link your GitHub repo to **Railway.app**.
2. Add your `.env` variables in the Railway dashboard.
3. Railway will provide a production `https` URL.
4. Update your Skill Manifest in the Trace Dashboard with the new URL.

### Option 2: Vercel
1. Ensure your Express app is wrapped for Vercel (see `vercel.json` in template).
2. `npx vercel` to deploy.

---

### Need Help?
Reach out to **ishaan@endlessriver.ai** or check the **[Developer Reference](https://endlessriver.ai/dashboard/docs)** (or `/dashboard/docs` on your Trace domain) for more details.

**Happy Building! 🛠️**
