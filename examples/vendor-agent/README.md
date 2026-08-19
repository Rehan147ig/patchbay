# Vendor agent ingest — quickstart

Post an OpenAI-shaped breaking-change event into Patchbay with one `curl`. This
is the **vendor → Patchbay** channel: your code pushes events; Patchbay never
writes to your customers' GitHub repositories. Patchbay normalizes the event,
finds affected customer usage, evaluates policy, and opens governed **draft**
PRs on its own.

Time to first event: under 10 minutes.

## 1. Prereqs

- A running Patchbay (`pnpm dev`), reachable at `PATCHBAY_URL`
  (default `http://localhost:3000`).
- An ADMIN session on Patchbay (one-click demo user on `/login`).
- `curl` — or run `node ingest.mjs` for the same request from Node 18+.

## 2. Get an agent key (one time)

1. Open **Settings** → **Monitored vendors** (ADMIN only).
2. Next to your vendor, click **Issue key** (or **Rotate key** to replace an
   existing key; the old key stays valid until the next rotation).
3. Copy the plaintext key **now** — it is shown exactly once and only its hash
   is stored. Never commit it to git.

Local development is seeded with a key you can also use for the `openai`
vendor: `pb_agent_dev_openai` (dev only, never in production).

## 3. Set environment

```bash
export PATCHBAY_URL="http://localhost:3000"   # where Patchbay runs
export AGENT_KEY="pb_agent_..."               # the key from step 2
```

## 4. Post an OpenAI-shaped change

```bash
curl -sS -X POST "$PATCHBAY_URL/api/vendors/openai/events" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "externalReference": "openai-node-4.0.0",
    "sourceType": "SDK_RELEASE",
    "severity": "HIGH",
    "rawPayload": {
      "sdk": "openai",
      "fromVersion": "3.x",
      "toVersion": "4.x",
      "migration": {
        "methodRenames": [
          {
            "from": "openai.createChatCompletion",
            "to": "openai.chat.completions.create",
            "breaking": true
          }
        ],
        "responseChanges": [
          {
            "symbol": "completion.data",
            "description": "v4 responses are returned directly; the wrapping .data field is gone.",
            "breaking": true
          }
        ]
      },
      "breaking": true
    }
  }'
```

Expected response (201):

```json
{ "data": { "changeEventId": "...", "status": "QUEUED", "normalizations": 2 } }
```

## 5. Verify

The event lands on **/changes** and is triaged by the worker (`ANALYZE_CHANGE`):
normalizations, impact assessments, and governed remediations follow the normal
pipeline.

## Contract notes

- Auth: `Authorization: Bearer <key>` — keys start with `pb_agent_`.
- Body cap: 256 KB. Fields: `rawPayload` (required), `externalReference`,
  `sourceType`, `sourceUrl`, `severity` (see
  `docs/vendor-agent-ingest.md` for the full spec).
- Use your own `externalReference` as an idempotency key if you retry; Patchbay
  does not deduplicate agent events today.
- No secrets in git: everything here comes from environment variables.
