import twilio from "twilio";

import { logger } from "./logger";

// Shared Twilio client for the notification services.
// Initialized once at boot using environment credentials.
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export function getTwilioClient() {
  return client;
}
