import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * AWS SDK for JavaScript v2 → v3 connector.
 *
 * Detection + impact only (ASSESS/PLAN). Rule pack exists but patches are
 * DEMOTED: the v2→v3 rename produces TS2304 errors because the new client
 * names are never imported. Re-certification requires import-aware rules
 * that pass the semantic gate.
 */
export const awsSdkConnector = defineConnector({
  slug: "aws-sdk",
  identifiers: ["aws-sdk", "aws"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "new AWS.S3()",
      newValue: "new S3Client()",
      description:
        "AWS SDK v3 replaced service classes with clients: `new AWS.S3()` becomes `new S3Client()`.",
      affectedSymbols: ["AWS.S3", "AWS.SQS", "AWS.DynamoDB"],
      breaking: true,
      evidence: { sdk: "aws-sdk", riskTag: RiskTag.INFRASTRUCTURE, rule: "v2-client-rename" },
    },
  ],
  // No patchSuggestions: renames without imports produce TS2304. Restore
  // only when the rule pack adds correct @aws-sdk/client-* imports alongside
  // the rename AND passes runSemanticGate.
});
