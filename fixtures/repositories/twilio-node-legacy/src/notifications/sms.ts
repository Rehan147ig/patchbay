import { getTwilioClient } from "../lib/twilio-client";
import { logger } from "../lib/logger";

const MAX_SMS_LENGTH = 1600;

export async function sendSms(to: string, body: string, from: string): Promise<string> {
  const client = getTwilioClient();

  if (!to.startsWith("+")) {
    throw new Error("SMS recipient must be an E.164 number");
  }

  if (body.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS body exceeds ${MAX_SMS_LENGTH} characters`);
  }

  logger.info("sending sms", { to });
  const result = await client.messages.create({ body, to, from });
  logger.info("sms sent", { sid: result.sid });
  return result.sid;
}
