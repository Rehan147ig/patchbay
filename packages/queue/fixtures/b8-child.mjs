// B8 child process fixture
// Receives REDIS_URL, KEY, LIMIT, ACQUIRE_LUA via environment variables
// Executes EVAL directly, prints JSON to stdout, exits without release

import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL;
const key = process.env.KEY;
const limit = parseInt(process.env.LIMIT, 10);
const luaScript = process.env.ACQUIRE_LUA;

if (!redisUrl || !key || !luaScript || isNaN(limit)) {
  console.error("Missing required env vars: REDIS_URL, KEY, LIMIT, ACQUIRE_LUA");
  process.exit(1);
}

async function main() {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  // Do NOT initialize the key to limit - 1.
  // The parent must begin from an empty key,
  // so the child proves it acquires one slot and leaves it abandoned.

  // Connect explicitly
  await redis.connect();

  // Execute the shared Lua ACQUIRE script
  const result = await redis.eval(luaScript, 1, key, String(limit), "86400");

  // Validate result structure
  if (!Array.isArray(result) || result.length < 2) {
    console.error("B8: unexpected EVAL result structure");
    process.exit(1);
  }

  const allowedFlag = result[0];
  const slotCount = result[1];
  const allowed = allowedFlag === 1;

  // Output exactly one JSON object to stdout
  process.stdout.write(JSON.stringify({ allowed, slotCount }));

  // Exit without releasing the slot (as required by B8 crash scenario)
  process.exit(0);
}

main().catch((err) => {
  console.error("B8 child error:", err.message);
  process.exit(1);
});
