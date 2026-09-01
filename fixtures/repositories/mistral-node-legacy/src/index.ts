// mistral node legacy fixture (v3 -> v4 SDK upgrade)
// THIS FIXTURE HAS CONCRETE SDK PATTERNS the AST analyzer can detect
// V3: import { MistralAI } from "@mistralai/mistralai"
// V4: use new Mistral large model with updated API

import { MistralAI } from "@mistralai/mistralai";

const client = new MistralAI({
  apiKey: process.env.MISTRAL_API_KEY,
  // v3: direct client usage with chat API
});

// v3: chat completion with model name - THIS IS THE PATTERN THE ANALYZER DETECTS
export const MistralChatService = {
  // AST analyzer detects: client.chat({ model: "mistral-large-latest", messages })
  async chatCompletion(messages: any[]) {
    return client.chat({
      model: "mistral-large-latest",
      messages,
    });
  },
  // v4: async streaming chat
  async chatCompletionStream(messages: any[]) {
    return client.chat.stream({
      model: "mistral-large-2402",
      messages,
    });
  },
};

// Export for analysis
export { MistralChatService };