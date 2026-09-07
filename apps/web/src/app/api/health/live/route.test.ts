import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

function request(): NextRequest {
  return new Request("http://localhost/api/health/live", {
    method: "GET",
    headers: { "x-correlation-id": "live-test-correlation" },
  }) as NextRequest;
}

describe("GET /api/health/live", () => {
  it("returns ok without requiring database or Redis dependencies", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("live-test-correlation");
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ status: "ok", service: "web" });
  });
});
