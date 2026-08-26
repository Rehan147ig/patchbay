import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { notFound } from "@patchbay/domain";
import { getRegistryRecipe } from "@patchbay/vendor-connectors";

/**
 * GET /api/registry/:vendor/:from/:to
 * Public - returns a single certified migration recipe.
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
    return jsonOk(recipe, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
