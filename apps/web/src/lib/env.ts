import "server-only";
import { parseEnv } from "@patchbay/env";

/**
 * Parsed, validated environment for the web app. Importing this module
 * fails fast at boot if the runtime configuration is invalid. Do not import
 * from edge middleware — edge bundles cannot read process.env wholesale.
 */
export const env = parseEnv();
