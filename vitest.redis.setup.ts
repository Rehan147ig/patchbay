import { Redis } from "ioredis";

export default async function setup() {
  const client = new Redis("redis://127.0.0.1:6379");
  // ioredis connects lazily; wait for ready
  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", (err) => reject(err));
    // fallback timeout 5s
    setTimeout(() => resolve(), 5000);
  });
  (global as unknown as Record<string, unknown>).redis = client;
  (global as unknown as Record<string, unknown>).TEST_PREFIX = "test:p0_c:";
}
