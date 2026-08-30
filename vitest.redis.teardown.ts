export default async function teardown() {
  const client = (global as unknown as Record<string, unknown>).redis as
    import("ioredis").Redis | undefined;
  if (client) {
    try {
      const keys = await client.keys("test:p0_c:*");
      if (keys.length > 0) {
        await client.del(...keys);
      }
      // also clean org_conc/global_conc test keys
      const extra = await client.keys("org_conc:*");
      if (extra.length > 0) await client.del(...extra);
      const g = await client.get("global_conc");
      if (g !== null) await client.del("global_conc");
    } catch {
      // ignore cleanup errors
    }
    await client.quit();
  }
}
