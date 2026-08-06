import { dispatchOutbound } from "./notifications/queue";
import { getTwilioClient } from "./lib/twilio-client";

getTwilioClient();

export const notificationService = {
  dispatchOutbound,
};
