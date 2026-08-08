import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Kubernetes connector.
 *
 * Kubernetes client API churn:
 * - Deprecated API versions removed (e.g. networking.k8s.io/v1beta1,
 *   extensions/v1beta1) — manifests must move to stable versions.
 * - The JS client (@kubernetes/client-node) renames API groups/objects
 *   across versions; `AppsV1Api` etc. changed method names.
 * - client-go (Go) removed deprecated clientsets.
 */
export const kubernetesConnector = defineConnector({
  slug: "kubernetes",
  identifiers: ["kubernetes", "@kubernetes/client-node", "k8s", "client-go"],
  rules: [
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "v1beta1 / v1beta2 API groups",
      newValue: "stable API versions",
      description:
        "Deprecated API groups (extensions/v1beta1, networking.k8s.io/v1beta1, etc.) are removed; migrate manifests to stable versions.",
      affectedSymbols: ["extensions/v1beta1", "networking.k8s.io/v1beta1", "batch/v1beta1"],
      breaking: true,
      evidence: { sdk: "kubernetes", riskTag: RiskTag.INFRASTRUCTURE },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "client-node API method",
      description:
        "@kubernetes/client-node renames API methods across majors (patch/read/create variants).",
      affectedSymbols: ["KubernetesObjectApi", "AppsV1Api", "CoreV1Api"],
      breaking: true,
      evidence: { sdk: "kubernetes" },
    },
  ],
  patchSuggestions: {
    "extensions/v1beta1": {
      replacement: "apps/v1",
      description: "Migrate extensions/v1beta1 manifests to apps/v1 (Deployment, Ingress, etc.).",
      confidence: 85,
    },
    "networking.k8s.io/v1beta1": {
      replacement: "networking.k8s.io/v1",
      description: "Migrate networking.k8s.io/v1beta1 Ingress to networking.k8s.io/v1.",
      confidence: 85,
    },
  },
});
