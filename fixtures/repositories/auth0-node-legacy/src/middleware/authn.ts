import type { Request, Response, NextFunction } from "express";
import auth0 from "auth0";
import { auth0Config } from "../config/auth";
import { logger } from "../lib/logger";

const AUTH0_CLIENT = new auth0.AuthenticationClient(auth0Config);

export async function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    response.status(401).json({ error: "missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);

  logger.info("verifying jwt", { audience: process.env.AUTH0_AUDIENCE });
  const payload = await auth0.verifyJwt({ audience: process.env.AUTH0_AUDIENCE });
  request.user = { sub: payload.sub ?? "", email: payload.email ?? "" };
  next();
}
