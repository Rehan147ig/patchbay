import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Terraform connector.
 *
 * Terraform provider versioning and HCL changes that break configs:
 * - Provider upgrades rename resources/data sources
 *   (aws_instance -> aws_instance, but e.g. aws_lb -> aws_alb historically,
 *   and provider resource renames happen every major).
 * - `count` vs `for_each` semantics changed (for_each with maps, count
 *   with sets).
 * - State/plan JSON schemas changed; `terraform validate` catches most but
 *   not the provider-level renames.
 * - Module versions should be pinned (unpinned = supply chain risk).
 */
export const terraformConnector = defineConnector({
  slug: "terraform",
  identifiers: ["terraform", "terraform-provider", "opentofu"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "provider resource rename",
      description:
        "Provider majors rename resources/data sources; apply the provider's upgrade guide renames.",
      affectedSymbols: ["resource", "data"],
      breaking: true,
      evidence: { sdk: "terraform", riskTag: RiskTag.INFRASTRUCTURE },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "count / for_each",
      description:
        "count and for_each semantics changed (for_each keys, count with sets); invalid meta-arguments now fail plan.",
      affectedSymbols: ["resource", "module"],
      breaking: true,
      evidence: { sdk: "terraform" },
    },
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "unpinned module",
      description:
        "Module references should be pinned to a version tag; unpinned refs are a supply-chain risk.",
      affectedSymbols: ["module"],
      breaking: false,
      evidence: { sdk: "terraform", riskTag: RiskTag.INFRASTRUCTURE },
    },
  ],
  patchSuggestions: {
    resource: {
      replacement: "resource (renamed)",
      description:
        "Apply the provider upgrade guide's resource/data renames and update references.",
      confidence: 70,
    },
  },
});
