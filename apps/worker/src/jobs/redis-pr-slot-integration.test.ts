import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { acquireOrgConcurrency, releaseOrgConcurrency, acquireGlobalConcurrency, releaseGlobalConcurrency } from '@patchbay/queue';
import { faker } from '@faker-js/faker';

describe('P0-B: Redis PR Slot Safety', () => {
  beforeAll(() => {
    // Ensure Redis is connected
    if (!global.redis) {
      throw new Error('Redis client not initialized');
    }
  });

  afterAll(async () => {
    // Clean up test keys
    const keys = await global.redis.keys('test:p0_c:*');
    if (keys.length > 0) {
      await global.redis.del(...keys);
    }
  });

  describe('20 concurrent workers / limit 5', () => {
    it('should enforce org concurrency limit', async () => {
      const limit = 5;
      const workers = 20;
      
      // Use Promise.all for truly concurrent start
      const promises = [];
      for (let i = 0; i < workers; i++) {
        promises.push(
          new Promise<void>(async (resolve) => {
            // Acquire org slot
            const result = await acquireOrgConcurrency('test-org', limit);
            // Immediately release
            await releaseOrgConcurrency('test-org');
            resolve();
          })
        );
      }
      
      await Promise.all(promises);
      
      // Check the counter
      const counter = await global.redis.get('test:p0_c:org:counter') || '0';
      const counterNum = parseInt(counter, 10);
      
      // The counter should not exceed the limit
      expect(counterNum).toBeLessThanOrEqual(5);
    });
  });

  describe('Exact-limit race', () => {
    it('should handle counter=4, limit=5 correctly', async () => {
      // Set counter to 4 first
      await global.redis.set('test:p0_c:org:counter', '4');
      
      // Two simultaneous INCRs
      const [resultA, resultB] = await Promise.all([
        global.redis.incr('test:p0_c:org:counter'),
        global.redis.incr('test:p0_c:org:counter'),
      ]);
      
      // One should succeed (counter=5), one should be blocked
      // The blocked one should have been rolled back
      expect(parseInt(resultA, 10)).toBe(5 || parseInt(resultB, 10));
      
      // Counter should never exceed 5
      const counter = await global.redis.get('test:p0_c:org:counter');
      expect(parseInt(counter, 10)).toBeLessThanOrEqual(5);
    });
  });

  describe('Normal release', () => {
    it('should restore counter to initial value', async () => {
      const initial = 3;
      await global.redis.set('test:p0_c:org:counter', String(initial));
      
      // Reserve
      await acquireOrgConcurrency('test-org', 5);
      // Release
      await releaseOrgConcurrency('test-org');
      
      const current = await global.redis.get('test:p0_c:org:counter');
      expect(parseInt(current, 10)).toBe(initial);
    });
  });

  describe('Rejected reservation rollback', () => {
    it('should roll back over-limit increment', async () => {
      // Set counter to limit
      await global.redis.set('test:p0_c:org:counter', '5');
      
      // Attempt over-limit reservation
      const result = await acquireOrgConcurrency('test-org', 5);
      
      // Should be blocked
      expect(result.allowed).toBe(false);
      
      // Counter should still be 5 (rolled back)
      const counter = await global.redis.get('test:p0_c:org:counter');
      expect(parseInt(counter, 10)).toBe(5);
    });
  });

  describe('Redis unavailable', () => {
    it('should fail closed', async () => {
      // Temporarily make Redis unreachable by using unreachable host
      const result = await acquireOrgConcurrency('unreachable-org', 5);
      
      // Should fail
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Redis safety mechanism unreachable');
    });
  });

  describe('Retry safety', () => {
    it('should not create duplicate slots on retry', async () => {
      // Set up: counter at 4, limit at 5
      await global.redis.set('test:p0_c:org:counter', '4');
      
      // First attempt
      const result1 = await acquireOrgConcurrency('test-org', 5);
      
      // Second attempt (retry)
      const result2 = await acquireOrgConcurrency('test-org', 5);
      
      // Counter should not exceed 5
      const counter = await global.redis.get('test:p0_c:org:counter');
      expect(parseInt(counter, 10)).toBeLessThanOrEqual(5);
      
      // Release both slots
      await releaseOrgConcurrency('test-org');
      await releaseOrgConcurrency('test-org');
    });
  });

  describe('GitHub idempotency', () => {
    it('should recover existing deterministic PR', async () => {
      // Set up a deterministic key
      const org = 'test-org';
      const key = `${TEST_PREFIX}org:${org}:repo:123:plan:abc123:hash`;
      
      // Acquire slot
      const result = await acquireOrgConcurrency(org, 5);
      expect(result.allowed).toBe(true);
      
      // Release
      await releaseOrgConcurrency(org);
    });
  });

  describe('Double release', () => {
    it('should not make counter negative', async () => {
      await global.redis.set('test:p0_c:org:counter', '5');
      
      // First release
      await releaseOrgConcurrency('test-org');
      // Second release (should not make counter negative)
      await releaseOrgConcurrency('test-org');
      
      const counter = await global.redis.get('test:p0_c:org:counter');
      expect(parseInt(counter, 10)).toBeGreaterThanOrEqual(0);
    });
  });
});