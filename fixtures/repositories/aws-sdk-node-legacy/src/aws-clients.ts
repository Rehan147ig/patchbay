import AWS from "aws-sdk";

import { logger } from "./lib/logger";

export function createAwsClients() {
  logger.info("creating aws v2 clients");
  const s3 = new AWS.S3({ region: "us-east-1" });
  const sqs = new AWS.SQS({ region: "us-east-1" });
  const dynamo = new AWS.DynamoDB({ region: "us-east-1" });
  return { s3, sqs, dynamo };
}
