import { RiskTag } from "@patchbay/domain";

/**
 * Deterministic, conservative risk classification for a single usage.
 * Keyword-based on the symbol and file path; the policy engine (Phase 5)
 * refines decisions later. Test-only files always get TEST_ONLY.
 */
export function classifyRiskTags(filePath: string, symbol: string): RiskTag[] {
  const tags = new Set<RiskTag>();
  const lowerPath = filePath.toLowerCase();
  const lowerSymbol = symbol.toLowerCase();

  if (
    /(^|\/)test\//.test(lowerPath) ||
    /\.(test|spec)\./.test(lowerPath) ||
    lowerPath.includes("__tests__")
  ) {
    tags.add(RiskTag.TEST_ONLY);
  }

  if (
    /(^|\/)payments?\//.test(lowerPath) ||
    /payment|charge|refund|invoice|payout|billing|checkout/.test(lowerSymbol)
  ) {
    tags.add(RiskTag.PAYMENT);
  }

  if (
    /(^|\/)auth(n|z)?\//.test(lowerPath) ||
    /auth|jwt|verifyjwt|authorization|authenticate/.test(lowerSymbol)
  ) {
    tags.add(RiskTag.AUTH);
  }

  if (
    /(^|\/)webhooks?\//.test(lowerPath) ||
    /webhook|constructevent|verifysignature/.test(lowerSymbol)
  ) {
    tags.add(RiskTag.WEBHOOK);
  }

  return [...tags];
}
