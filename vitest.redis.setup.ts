import { createClient } from 'redis';

export default async function setup() {
  // Connect to Redis using the GitHub Actions service host
  // The GitHub Actions redis service binds to 127.0.0.1:6379
  const client = createClient({
    url: 'redis://127.0.0.1:6379',
  });
  await client.connect();
  
  // Export client for test files via globals
  global.redis = client;
  
  // Set test key namespace to avoid collisions
  global.TEST_PREFIX = 'test:p0_c:';
}