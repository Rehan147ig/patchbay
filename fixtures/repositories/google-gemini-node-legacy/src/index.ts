// google-gemini node legacy fixture (v3 -> v4 SDK upgrade)
// THIS FIXTURE HAS CONCRETE SDK PATTERNS the AST analyzer can detect
// V3: import { GoogleGenerativeAI } from "@google/generative-ai"
// V4: use google-genai with new SDK patterns

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI({
  apiKey: process.env.GOOGLE_AI_API_KEY,
  // v3 config with generationConfig
  generationConfig: {
    temperature: 0.7,
    topP: 1,
    topK: 40,
    maxOutputTokens: 8192,
  },
});

// v3: generateContent with single prompt - THIS IS THE PATTERN THE ANALYZER DETECTS
export const GeminiChatService = {
  // AST analyzer detects: genAI.getModel("gemini-1.5-pro").generateContent(
  async generateContent(prompt: string) {
    const model = genAI.getModel("gemini-1.5-pro");
    return model.generateContent(prompt);
  },
  // v4: new method with system instruction
  async sendMessage(message: string) {
    const model = genAI.getModel("gemini-1.5-pro");
    return model.sendMessage(message);
  },
};

// Export for analysis
export { GeminiChatService };