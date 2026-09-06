import { Client } from "@modelcontextprotocol/sdk";

import { logger } from "./logger";

export function createAgentClient(): Client {
  const client = new Client({ name: "acme-agent", version: "1.4.0" });
  logger.debug("creating mcp agent client");
  return client;
}

export const agentClient = createAgentClient();

export async function listAgentTools(): Promise<string[]> {
  const tools = await agentClient.listTools();
  return tools.tools.map((tool) => tool.name);
}
