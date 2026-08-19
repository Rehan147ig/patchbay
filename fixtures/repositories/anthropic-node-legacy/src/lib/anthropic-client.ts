import Anthropic from "@anthropic-ai/sdk";

import { logger } from "./logger";

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  logger.debug("creating anthropic client", { hasKey: Boolean(apiKey) });
  const anthropic = new Anthropic({ apiKey });
  return anthropic;
}

export const anthropic = createAnthropicClient();
