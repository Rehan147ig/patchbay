import { runChat } from "./chat-service";
import { logger } from "../lib/logger";

export interface ChatRouteInput {
  userId: string;
  channelId: string;
}

export async function handleChatRequest(
  input: ChatRouteInput,
): Promise<{ status: number; body: unknown }> {
  const reply = await runChat(input);
  logger.info("chat handled", { userId: input.userId });
  return { status: 200, body: reply };
}
