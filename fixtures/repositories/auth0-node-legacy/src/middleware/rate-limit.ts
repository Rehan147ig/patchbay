import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const buckets = new Map<string, number[]>();

export function rateLimit(
  maxRequests: number,
  windowMs: number,
): (req: Request, res: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const key = request.ip ?? "unknown";
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    recent.push(now);
    buckets.set(key, recent);
    if (recent.length > maxRequests) {
      logger.warn("rate limited", { ip: key });
      response.status(429).json({ error: "too many requests" });
      return;
    }
    next();
  };
}
