import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { CertificationState, ContractKind } from "@patchbay/domain";
import { GET } from "./route";

function request(): NextRequest {
  return new Request("http://localhost/api/capability-matrix", { method: "GET" }) as NextRequest;
}

describe("GET /api/capability-matrix", () => {
  it("serves the §2.2 vocabulary byte-identical to the domain source", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        vocabulary: {
          matrixVersion: number;
          contractKinds: string[];
          certificationStates: string[];
          deliveryModes: string[];
        };
      };
    };
    expect(body.data.vocabulary.matrixVersion).toBe(1);
    expect(body.data.vocabulary.contractKinds).toEqual(Object.values(ContractKind));
    expect(body.data.vocabulary.certificationStates).toEqual(Object.values(CertificationState));
    expect(body.data.vocabulary.deliveryModes).toContain("CHECK_RUN");
  });
});
