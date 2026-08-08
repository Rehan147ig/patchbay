import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * AWS SDK for JavaScript v2 -> v3 connector.
 *
 * v3 is a per-service modular SDK: `aws-sdk` is replaced by `@aws-sdk/client-*`,
 * `new AWS.S3()` becomes `new S3Client()` + `SendCommand`, and the chainable
 * `.promise()` API is gone (async/await is native). Credentials moved to
 * `@aws-sdk/credential-providers`.
 */
export const awsSdkConnector = defineConnector({
  slug: "aws-sdk",
  identifiers: ["aws-sdk", "aws"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "aws-sdk .promise()",
      newValue: "async/await",
      description:
        "AWS SDK v3 removed `.promise()`; service methods now return promises directly, so `await` or `.then` replaces `.promise()`.",
      affectedSymbols: ["S3.promise", "DynamoDB.promise", "Lambda.promise", "SQS.promise"],
      breaking: true,
      evidence: { sdk: "aws-sdk", riskTag: RiskTag.INFRASTRUCTURE },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "new AWS.S3()",
      newValue: "new S3Client()",
      description:
        "AWS SDK v3 replaced service classes with clients: `new AWS.S3()` becomes `new S3Client({ region })` plus `SendCommand`.",
      affectedSymbols: ["AWS.S3", "AWS.DynamoDB", "AWS.Lambda", "AWS.SQS"],
      breaking: true,
      evidence: { sdk: "aws-sdk", riskTag: RiskTag.INFRASTRUCTURE },
    },
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "aws-sdk@2",
      newValue: "@aws-sdk/client-*@3",
      description:
        "Migrate from the monolithic aws-sdk@2 package to the modular @aws-sdk/client-* packages.",
      affectedSymbols: ["require('aws-sdk')", "import 'aws-sdk'"],
      breaking: true,
      evidence: { sdk: "aws-sdk" },
    },
  ],
  patchSuggestions: {
    "AWS.S3": {
      replacement: "S3Client",
      description:
        "Replace `new AWS.S3()` with `new S3Client({ region })` from @aws-sdk/client-s3 and use `SendCommand` with `GetObjectCommand`/`PutObjectCommand`.",
      confidence: 85,
    },
    "AWS.DynamoDB": {
      replacement: "DynamoDBClient",
      description:
        "Replace `new AWS.DynamoDB()` with `new DynamoDBClient()` from @aws-sdk/client-dynamodb and use SendCommand with command objects.",
      confidence: 85,
    },
    "S3.promise": {
      replacement: "await",
      description:
        "Replace `.promise()` with native async/await; v3 methods return promises directly.",
      confidence: 95,
    },
  },
});
