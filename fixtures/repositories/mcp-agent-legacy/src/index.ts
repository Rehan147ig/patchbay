import { app } from "./server";
import { createAgentClient } from "./lib/agent-client";

createAgentClient();

export const mcpAgentService = {
  app,
};
