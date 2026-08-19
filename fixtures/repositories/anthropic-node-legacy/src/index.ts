import { completePrompt } from "./chat/complete";
import { createAnthropicClient } from "./lib/anthropic-client";

createAnthropicClient();

export const claudeAssistantService = {
  completePrompt,
};
