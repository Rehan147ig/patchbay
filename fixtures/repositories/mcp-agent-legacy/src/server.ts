import express from "express";

import { listAgentTools } from "./lib/agent-client";
import { logger } from "./lib/logger";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/run", async (req, res) => {
  logger.info("agent run requested", { task: req.body?.task ?? null });
  const tools = await listAgentTools();
  res.json({ tools });
});

const router = express.Router();

router.delete("/api/sessions/:id", (req, res) => {
  logger.info("session revoked", { id: req.params?.id ?? null });
  res.status(204).end();
});

app.use("/v1", router);

export { app };
