# 🛠️ Trace Template Skill

This is a minimal, production-ready template for building **Trace Skills**. It includes everything you need to handle background events (Webhooks) and voice-native interactions (MCP).

---

## 🚀 Quickstart

### 1. Setup
```bash
npm install
cp .env.example .env
```
Fill in your `TRACE_HMAC_SECRET` in `.env` once you register your skill.

### 2. Local Development
```bash
npm run dev
```
In a separate terminal, expose your local server to the internet using **ngrok**:
```bash
ngrok http 3000
```
*Take note of the `https` URL ngrok provides (e.g., `https://abcd-123.ngrok-free.app`).*

---

## 📝 Manifest & Registration

Your skill is defined by the `manifest.json`. You must submit this manifest via the **Trace Developer Dashboard**.

### Key Fields:
- **`name`**: Human-readable name of your skill.
- **`interface`**: `hybrid` allows both Webhooks and MCP.
- **`triggers`**: Defines what events your skill "listens" to. By default, it listens to `interaction.dialog` (voice).
- **`permissions`**: List of permissions your skill needs. Common ones:
    - `notification.send`: (Implicit) Ability to sent toasts/TTS.
    - `user.profile.read`: Ability to see the user's name.
    - `user.location.read`: Ability to see city/country/GPS.
- **`domains`**: Natural language descriptions that tell the Trace Router when to send an event to your skill.
- **`allowedTools`**: Declares which platform-managed tools (like `mail.send`) your skill can use.

### Registration Steps:
1. Go to **Dashboard** → **Skills** → **Create New Skill**.
2. Paste your ngrok URL into the **Webhook** and **MCP** endpoint fields.
3. Use the contents of `manifest.json` as a guide for your configuration.
4. **Save** and copy the **HMAC Secret** into your `.env` file.

---

## 🔌 Using Platform Actions

This template shows you how to return **responses** that trigger actions on the user's glasses:

- **Notifications**: Toast messages and TTS.
- **Feed Items**: Logging activity to the daily feed.
- **Platform Tools**: Sending emails or creating calendar events via `tool_call`.

Check `src/index.ts` to see how these are constructed.

---

## 🔒 Security

- **HMAC Verification**: All requests from Trace are signed. The `src/hmac.ts` utility ensures only legitimate Trace events are processed.
- **Proxy IDs**: `user.id` is a stable, unique proxy for that specific user. Use it as a primary key in your database.
- **User Info**: If you have the right permissions, the `user` object will contain `name`, `timezone`, and `location`. Timezone and Locale are always provided.

---

## 🚢 Deployment

Ready to go live? Check out the `deploy.sh` script for instructions on deploying to **Railway** or **Vercel**.

1. Deploy your server.
2. Get the new production URL.
3. Update your endpoints in the **Trace Developer Dashboard**.

---

### Need Help?
Reach out to **ishaan@endlessriver.ai** or check the **[Developer Reference](https://endlessriver.ai/dashboard/docs)** (or `/dashboard/docs` on your Trace domain) for more details.

You can also follow the full **[Skill Builder Playbook](./docs/buildathon/SKILL_BUILDER_PLAYBOOK.md)** for a deep dive.
**Happy Building! 🛠️**
