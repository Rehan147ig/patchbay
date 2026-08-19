#!/usr/bin/env node
/**
 * Minimal vendor-agent ingest example (Node 18+ built-in fetch, zero deps).
 *
 * Usage:
 *   AGENT_KEY=pb_agent_... PATCHBAY_URL=http://localhost:3000 node ingest.mjs
 *
 * Posts an OpenAI-shaped change event to Patchbay's vendor-agent endpoint.
 * The vendor never writes customer repositories; Patchbay owns remediation.
 */
const PATCHBAY_URL = process.env.PATCHBAY_URL ?? "http://localhost:3000";
const AGENT_KEY = process.env.AGENT_KEY;
const SLUG = process.env.SLUG ?? "openai";

if (!AGENT_KEY) {
  console.error("AGENT_KEY is required (Settings → Monitored vendors → Issue key)");
  process.exit(1);
}

const body = {
  externalReference: "openai-node-4.0.0",
  sourceType: "SDK_RELEASE",
  severity: "HIGH",
  rawPayload: {
    sdk: "openai",
    fromVersion: "3.x",
    toVersion: "4.x",
    migration: {
      methodRenames: [
        {
          from: "openai.createChatCompletion",
          to: "openai.chat.completions.create",
          breaking: true,
        },
      ],
      responseChanges: [
        {
          symbol: "completion.data",
          description: "v4 responses are returned directly; the wrapping .data field is gone.",
          breaking: true,
        },
      ],
    },
    breaking: true,
  },
};

const response = await fetch(`${PATCHBAY_URL}/api/vendors/${SLUG}/events`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${AGENT_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

const result = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(
    `ingest failed (${response.status}):`,
    result?.error?.message ?? response.statusText,
  );
  process.exit(1);
}

console.log(
  `queued ${SLUG} change ${result?.data?.changeEventId} (status ${result?.data?.status}, ` +
    `${result?.data?.normalizations} normalizations)`,
);
