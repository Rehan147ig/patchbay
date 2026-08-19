import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * AWS SDK for JavaScript v2 → v3 connector (certified DRAFT_PR).
 *
 * Certified pattern: constructor rename `new AWS.S3()` / `AWS.SQS` / `AWS.DynamoDB`
 * to `S3Client` / `SQSClient` / `DynamoDBClient`. The engine applies a line-level
 * symbol replace. It does not rewrite `.promise()`, imports, or SendCommand shapes.
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
  patchSuggestions: {
    "AWS.S3": {
      replacement: "S3Client",
      description: "Replace `new AWS.S3()` with `new S3Client()` from @aws-sdk/client-s3.",
      confidence: 90,
    },
    "AWS.SQS": {
      replacement: "SQSClient",
      description: "Replace `new AWS.SQS()` with `new SQSClient()` from @aws-sdk/client-sqs.",
      confidence: 90,
    },
    "AWS.DynamoDB": {
      replacement: "DynamoDBClient",
      description:
        "Replace `new AWS.DynamoDB()` with `new DynamoDBClient()` from @aws-sdk/client-dynamodb.",
      confidence: 90,
    },
  },
});
