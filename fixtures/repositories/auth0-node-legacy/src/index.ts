import { requireAuthentication } from "./middleware/authn";
import { requireRole } from "./middleware/authz";
import { rateLimit } from "./middleware/rate-limit";

export const authGateway = {
  requireAuthentication,
  requireRole,
  rateLimit,
};
