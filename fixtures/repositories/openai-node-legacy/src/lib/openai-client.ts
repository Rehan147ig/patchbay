import OpenAI from "openai";

import { logger } from "./logger";

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  logger.debug("creating openai client", { hasKey: Boolean(apiKey) });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export const openai = createOpenAIClient();
