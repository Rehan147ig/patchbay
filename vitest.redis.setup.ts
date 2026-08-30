export default async function setup() {
  (globalThis as unknown as Record<string, unknown>).TEST_PREFIX = "test:p0_c:";
}
