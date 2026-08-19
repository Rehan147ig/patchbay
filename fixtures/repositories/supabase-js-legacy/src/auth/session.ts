import { createClient } from "@supabase/supabase-js";

import { logger } from "../lib/logger";

const supabase = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_ANON_KEY ?? "");

export function currentUser() {
  logger.info("reading supabase session user");
  const user = supabase.auth.user();
  return user;
}
