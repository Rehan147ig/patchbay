import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST as approveMaintenance } from "./approve/route";
import { POST as draftPrMaintenance } from "./draft-pr/route";
import { POST as suppressMaintenance } from "./suppress/route";
import { POST as approveCase } from "../../../cases/[id]/approve/route";
import { POST as draftPrCase } from "../../../cases/[id]/draft-pr/route";
import { POST as cancelCase } from "../../../cases/[id]/cancel/route";

vi.mock("../../../cases/[id]/approve/route", () => ({ POST: vi.fn() }));
vi.mock("../../../cases/[id]/draft-pr/route", () => ({ POST: vi.fn() }));
vi.mock("../../../cases/[id]/cancel/route", () => ({ POST: vi.fn() }));

function request(path: string): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

describe("maintenance action aliases (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("approve delegates to the canonical case vector with identical args", async () => {
    vi.mocked(approveCase).mockResolvedValueOnce(Response.json({ ok: true }));
    const req = request("/api/maintenance/cases/case-1/approve");
    const params = { params: Promise.resolve({ id: "case-1" }) };
    await approveMaintenance(req, params);
    expect(approveCase).toHaveBeenCalledWith(req, params);
  });

  it("draft-pr delegates to the canonical case vector with identical args", async () => {
    vi.mocked(draftPrCase).mockResolvedValueOnce(Response.json({ ok: true }));
    const req = request("/api/maintenance/cases/case-1/draft-pr");
    const params = { params: Promise.resolve({ id: "case-1" }) };
    await draftPrMaintenance(req, params);
    expect(draftPrCase).toHaveBeenCalledWith(req, params);
  });

  it("suppress terminates through the cancel vector (same terminal state)", async () => {
    vi.mocked(cancelCase).mockResolvedValueOnce(Response.json({ ok: true }));
    const req = request("/api/maintenance/cases/case-1/suppress");
    const params = { params: Promise.resolve({ id: "case-1" }) };
    await suppressMaintenance(req, params);
    expect(cancelCase).toHaveBeenCalledWith(req, params);
  });
});
