import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function requireRole(
  role: "admin" | "member",
): (req: Request, res: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const userRole = (request as Request & { user?: { role?: string } }).user?.role;
    if (userRole !== role) {
      logger.warn("authorization denied", { required: role, actual: userRole ?? "anonymous" });
      response.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
