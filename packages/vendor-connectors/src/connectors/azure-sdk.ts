import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Azure SDK connector.
 *
 * Azure JS SDK v2 unified auth around @azure/identity:
 * - Service clients changed constructor signatures: `new SecretClient(url,
 *   credential)` where credential is a TokenCredential (was key/secret).
 * - `DefaultAzureCredential` / `ClientSecretCredential` replaced manual
 *   key-based auth everywhere.
 * - Some clients renamed methods (e.g. `getProperties` vs `getMetadata`).
 */
export const azureSdkConnector = defineConnector({
  slug: "azure-sdk",
  identifiers: ["azure", "@azure/*", "azure-sdk"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "key/secret in constructor",
      newValue: "TokenCredential (DefaultAzureCredential)",
      description:
        "Azure JS SDK v2 requires a TokenCredential from @azure/identity; passing raw keys/secrets to client constructors was removed.",
      affectedSymbols: ["SecretClient", "BlobServiceClient", "ServiceBusClient", "TableClient"],
      breaking: true,
      evidence: { sdk: "azure-sdk", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "getMetadata",
      description:
        "Several client methods were renamed across SDK v2 (e.g. getMetadata -> getProperties).",
      affectedSymbols: ["SecretClient", "BlobServiceClient"],
      breaking: true,
      evidence: { sdk: "azure-sdk" },
    },
  ],
  patchSuggestions: {
    SecretClient: {
      replacement: "new SecretClient(url, credential)",
      description:
        "Construct SecretClient with a TokenCredential (DefaultAzureCredential) instead of raw secrets.",
      confidence: 85,
    },
    BlobServiceClient: {
      replacement: "new BlobServiceClient(url, credential)",
      description: "Pass a TokenCredential to BlobServiceClient; update renamed methods.",
      confidence: 82,
    },
  },
});
