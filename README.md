# 🧬 Helix System Design

**Personal AI Sandbox** - A single brain that follows me across messaging apps and remembers what I said, and lets me tinker with the latest AI tech. Originally started in 2022 as a convenience project (before ChatGPT).

---

## Problem

Most AI chatbots feel generic, forget yesterday and who they are, are inconvenient to message, and generally are not very customizable. I want a something that:

* Is convenient to find and message.
* Keeps context so the convo doesn’t reset every time.
* Doubles as a sandbox for second‑brain experiments.
* Serves as a vehicle to test cutting-edge releases.

\*Note that many experiments are not deployed or committed publicly.

---

## Goals

* One brain, many apps.
* Real memory and quick recall.
* Hot‑swap models (OpenAI today, Gemini tomorrow).
* Cheap to run and easy to hack on at 2 AM.
* Grow into a personal AI‑clone down the road.
* Create a chatting companion that is truely human-like.

## Non‑Goals

* Video or audio processing.
* Fancy dashboards or deep analytics.
* Enterprise‑grade auth.
* Frontend experiments.

---

## High‑Level Flow

```text
Messaging app → Firebase Function → OpenAI API → User Response
                      ↕️             ↕️
                  Firebase DB     Notion API
```

1. Friend sends Tylr a message.
2. Webhook tags the platform + user.
3. Pull their profile + chat history id + previous thoughts.
4. Feed everything to LLM.
5. Update personality insights.
6. Send reply + typing indicators.
7. Save the new messages.

---

## Main Pieces

| Piece                | What it does                                 |
| -------------------- | -------------------------------------------- |
| 🧲 Webhook Handler   | Catches requests, routes them                |
| 🔌 Platform Adapters | Format tweaks for Messenger, IG, WhatsApp    |
| 🧠 LLM Engine        | Talks to OpenAI (and future models)          |
| 📦 User Store        | Profiles, memories, insights                 |
| 🧬 Personality Layer | Thoughts happend outside of the conversation |
| 🧰 Utils             | Logging, retries, helpers                    |

---

## Tech Stack & Why

* **Firebase Cloud Functions** — serverless, cheap, perfect for webhooks.
* **Firestore** — fast key‑value-ish DB, fine for chat history.
* **TypeScript** — keeps me from foot‑gunning.
* **OpenAI API** — best mix of quality + docs right now.
* **Notion API** — quick in‑place prompt edits on my phone.
* **Meta Platform APIs** — obvious.

---

### Scale / Reliability

* Serverless auto‑scales.
* Built‑in retries for flaky APIs.
* Centralized logs (Cloud Logging) + alerts.
* Stateless functions = easier restarts.
* Graceful degrade.

---

### Risks

* External APIs go down or change.
* Token costs can spike.
* Maintaining three platform adapters.

---

### User‑Side Walkthrough

1. Friend pings Tylr.
2. Tylr shows "read" + "typing".
3. Sends a personal, relevant, and human-like reply.
4. Tylr performs a personal reflection on the exchange.

---

## Runbook

### Deployment

```bash
# Deploy only the webhook function
npm run deploy
```

Required secrets:
- `VERIFY_TOKEN` for Meta webhook setup
- `META_APP_SECRET` (or `APP_SECRET`) for webhook signature verification
- `PAGE_ACCESS_TOKEN`, `OPENAI_API_KEY`, and Notion/Firebase credentials used by the function

### Monitoring & Logs

* **Real-time logs**: `firebase functions:log`
* **Cloud Logging**: Check Firebase Console → Functions → Logs
* **Key metrics to watch**:
  * Response time (should be <5s)
  * Error rate (should be <1%)
  * OpenAI API usage (check billing dashboards)

### Common Failures & Fixes

1. **Webhook timeouts**
   * Check OpenAI API status
   * Review recent code changes affecting response time
   * Temporary fix: Restart function via Firebase Console

2. **Message delivery failures**
   * Verify Meta platform status (Messenger/IG/WhatsApp)
   * Check access token validity and permissions
   * Fix: Regenerate tokens in Meta Developer Portal

3. **Memory/personality issues**
   * Check Notion API connectivity
   * Verify primer JSON format is valid
   * Fix: Update primer in Notion and check format

---

<!-- markdownlint-disable-next-line -->
*Last edited: 2025-05-02*
