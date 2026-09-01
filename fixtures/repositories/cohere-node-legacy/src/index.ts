// cohere node legacy fixture (v3 -> v4 SDK upgrade)
// THIS FIXTURE HAS CONCRETE SDK PATTERNS the AST analyzer can detect
// V3: import { CohereClient } from "cohere-ai"
// V4: use updated Cohere models with new naming

import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
  // v3: command-r model with generate call
});

// v3: generate response - THIS IS THE PATTERN THE ANALYZER DETECTS
export const CohereChatService = {
  // AST analyzer detects: cohere.generate({ model: "command-r", message })
  async generateResponse(message: string) {
    return cohere.generate({
      model: "command-r",
      message,
    });
  },
  // v4: improved with command-r+
  async generateResponseV2(message: string) {
    return cohere.generate({
      model: "command-r+",
      message,
    });
  },
};

// Export for analysis
export { CohereChatService };
