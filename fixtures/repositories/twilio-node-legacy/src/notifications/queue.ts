import { sendSms } from "./sms";
import { logger } from "../lib/logger";

export interface OutboundMessage {
  channel: "sms" | "email";
  to: string;
  body: string;
}

export async function dispatchOutbound(message: OutboundMessage): Promise<string> {
  if (message.channel === "sms") {
    logger.info("dispatching sms", { to: message.to });
    return sendSms(message.to, message.body, process.env.TWILIO_FROM_NUMBER ?? "+15005550006");
  }
  return "queued";
}
