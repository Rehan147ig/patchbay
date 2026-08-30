export default async function teardown() {
  const client = global.redis;
  if (client) {
    // Clean up test keys using the namespace prefix
    const keys = await client.keys('test:p0_c:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
    await client.quit();
  }
}