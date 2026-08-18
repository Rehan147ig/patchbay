# Vendor Agent Ingestion Specification

This document describes Patchbay's provider-agent ingestion interface (`POST /api/vendors/:slug/events`).

## Architectural Role

Vendor agent ingestion enables a vendor (e.g. Stripe, OpenAI, Twilio) or a CI pipeline to push structured breaking change and deprecation events directly into Patchbay.

> **Important**: This is a **vendor → Patchbay** notification channel. The vendor does **not** write to or modify customer repositories directly. Patchbay receives the event, normalizes it through the vendor's connector, matches impact against customer AST graphs, evaluates policies, runs sandbox validation, and opens governed draft pull requests.

---

## 1. Issuing an Agent Key

An administrator issues a per-vendor agent API key:

```http
POST /api/vendors/:slug/agent-key
Host: app.patchbay.dev
Cookie: pb_session=...
x-csrf-token: ...
```

**Response (200 OK):**

```json
{
  "data": {
    "vendorSlug": "openai",
    "agentKey": "pb_agent_a1b2c3d4e5f6...",
    "note": "Store this key now; it will never be shown again."
  }
}
```

- Keys use the prefix `pb_agent_` and are stored as SHA-256 hashes (`agentKeyHash`).
- Key rotation is supported: the previous key hash remains valid during the rotation window (`agentKeyHashPrevious`).
- **Dev-Only Seed Key**: The seeded database comes with `pb_agent_dev_openai` pre-configured for the `openai` vendor in local development only. Real production deployments generate unique keys via the route above.

---

## 2. Ingesting Change Events

The vendor pushes change payloads authenticated with the bearer token:

```http
POST /api/vendors/openai/events
Host: app.patchbay.dev
Authorization: Bearer pb_agent_a1b2c3d4e5f6...
Content-Type: application/json
```

**Request Body (Example: OpenAI Node SDK v4 deprecation):**

```json
{
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
        },
        {
          "from": "openai.createCompletion",
          "to": "openai.completions.create",
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
}
```

**Response (202 Accepted):**

```json
{
  "data": {
    "changeEventId": "c-openai-sdk-v4-1234",
    "normalizedChanges": 3,
    "status": "QUEUED"
  }
}
```

---

## 3. Ingestion Safety & Limits

- **Body Size Cap**: Maximum 256 KB (`MAX_AGENT_BODY_BYTES`), enforced on the streamed body.
- **Rate Limiting**: Rate limited globally and per-vendor.
- **Deduplication**: Change events are deduplicated by external reference and vendor ID.
- **Audit Trail**: Every ingestion produces an `AuditAction.AGENT_EVENT_INGESTED` record with correlation tracking.
