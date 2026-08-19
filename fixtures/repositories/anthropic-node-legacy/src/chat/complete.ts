import { anthropic } from "../lib/anthropic-client";
import { logger } from "../lib/logger";

export async function completePrompt(prompt: string): Promise<string> {
  logger.info("anthropic completion", { length: prompt.length });
  const completion = await anthropic.completions.create({
    model: "claude-2",
    prompt,
    max_tokens_to_sample: 256,
  });
  return completion.completion;
}
