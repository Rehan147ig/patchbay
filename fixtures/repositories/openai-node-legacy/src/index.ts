import { handleChatRequest } from "./chat/chat-router";
import { embedText } from "./embeddings/embedding-service";
import { createOpenAIClient } from "./lib/openai-client";

createOpenAIClient();

export const aiAssistantService = {
  handleChatRequest,
  embedText,
};
