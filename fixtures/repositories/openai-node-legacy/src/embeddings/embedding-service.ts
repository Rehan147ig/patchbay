import { openai } from "../lib/openai-client";
import { logger } from "../lib/logger";

export async function embedText(text: string): Promise<number[]> {
  logger.info("embedding text", { chars: text.length });
  const response = await openai.createEmbedding({
    model: "text-embedding-ada-002",
    input: text,
  });
  return response.data.data[0]?.embedding ?? [];
}
