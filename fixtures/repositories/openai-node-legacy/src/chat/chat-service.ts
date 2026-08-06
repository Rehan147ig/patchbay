import { openai } from "../lib/openai-client";
import { getConversation } from "./conversation-store";
import { logger } from "../lib/logger";

export interface ChatRequest {
  userId: string;
  channelId: string;
}

export interface ChatReply {
  content: string;
}

const DEFAULT_MODEL = "gpt-4";
const MAX_TOKENS = 1024;

export async function runChat(request: ChatRequest): Promise<ChatReply> {
  const history = await getConversation(request.channelId);
  const messages = [
    { role: "system" as const, content: "You are a helpful assistant." },
    ...history.map((line) => ({ role: "user" as const, content: line.text })),
  ];

  if (messages.length === 0) {
    return { content: "No conversation history yet." };
  }

  logger.info("chat request", { userId: request.userId });

  const options = { model: DEFAULT_MODEL, messages, max_tokens: MAX_TOKENS };
  const completion = openai.createChatCompletion({ model: "gpt-4", messages });
  return { content: completion.data.choices[0]?.message?.content ?? "" };
}
