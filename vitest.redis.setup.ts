// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: any;

export default async function setup() {
  const { Redis } = await import("ioredis");
  const client = new Redis("redis://127.0.0.1:6379");
  await new Promise<void>((resolve) => {
    client.once("ready", () => resolve());
    client.once("error", () => resolve());
    setTimeout(() => resolve(), 3000);
  });
  (global as unknown as Record<string, unknown>).redis = client;
  (global as unknown as Record<string, unknown>).TEST_PREFIX = "test:p0_c:";
}
