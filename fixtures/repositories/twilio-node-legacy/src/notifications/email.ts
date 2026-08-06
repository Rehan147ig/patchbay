import { logger } from "../lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(message: EmailMessage): Promise<string> {
  logger.info("sending email", { to: message.to, subject: message.subject });
  return `email-${message.to}-${Date.now()}`;
}
