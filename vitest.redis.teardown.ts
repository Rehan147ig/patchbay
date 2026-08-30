// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: any;

export default async function teardown() {
  const client = (global as unknown as Record<string, unknown>).redis as
    import("ioredis").Redis | undefined;
  if (client) {
    try {
      const keys = await client.keys("test:p0_c:*");
      if (keys.length > 0) await client.del(...keys);
      const extra = await client.keys("org_conc:*");
      if (extra.length > 0) await client.del(...extra);
      const g = await client.get("global_conc");
      if (g !== null) await client.del("global_conc");
      const p = await client.keys("pr_slot:*");
      if (p.length > 0) await client.del(...p);
    } catch {
      // ignore
    }
    await client.quit();
  }
}
