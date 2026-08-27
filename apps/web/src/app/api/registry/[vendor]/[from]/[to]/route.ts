import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { notFound } from "@patchbay/domain";
import { getRegistryRecipe, verifyRecipeSignature } from "@patchbay/vendor-connectors";

/**
 * GET /api/registry/:vendor/:from/:to
 * Public - returns a single certified migration recipe.
 * Includes X-Patch-Signature-Verified header (HMAC-SHA256, platform key).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vendor: string; from: string; to: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    const { vendor, from, to } = await params;
    const recipe = getRegistryRecipe(vendor, from, to);
    if (!recipe) throw notFound(`No certified recipe for ${vendor} ${from} -> ${to}`);
    const verified = verifyRecipeSignature(recipe);
    const response = jsonOk(recipe, correlationId);
    response.headers.set("x-patch-signature-verified", verified ? "true" : "false");
    response.headers.set("x-patch-signature", recipe.signature);
    if (!verified) {
      // Fail-closed: do not serve unverified recipe as DRAFT_PR.
      response.headers.set("x-patch-recipe-status", "unverified-fallback-to-plan");
    }
    return response;
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
