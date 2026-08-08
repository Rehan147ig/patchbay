import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Google Cloud connector.
 *
 * The monorepo split (google-cloud into per-service packages like
 * @google-cloud/firestore, @google-cloud/storage) plus auth changes:
 * - `google-cloud` umbrella imports broke; each service is its own package.
 * - `keyFile`/`credentials` moved to `GoogleAuth` from
 *   `google-auth-library`.
 * - Firestore `Timestamp` moved to `@google-cloud/firestore` and field
 *   paths use dot notation consistently.
 */
export const googleCloudConnector = defineConnector({
  slug: "google-cloud",
  identifiers: ["google-cloud", "@google-cloud/*", "gcloud"],
  rules: [
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "google-cloud umbrella",
      newValue: "@google-cloud/<service>",
      description:
        "The google-cloud monorepo was split; import per-service packages (@google-cloud/storage, @google-cloud/firestore, etc.).",
      affectedSymbols: [
        "require('google-cloud')",
        "import 'google-cloud'",
        "require('@google-cloud')",
      ],
      breaking: true,
      evidence: { sdk: "google-cloud" },
    },
    {
      changeType: "AUTH_CHANGE",
      oldValue: "keyFile / credentials in client",
      newValue: "GoogleAuth",
      description:
        "Client constructor credentials moved to GoogleAuth (google-auth-library); keyFile and credentials props were removed.",
      affectedSymbols: ["@google-cloud/storage", "@google-cloud/firestore", "@google-cloud/pubsub"],
      breaking: true,
      evidence: { sdk: "google-cloud", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "Timestamp.fromDate",
      description:
        "Timestamp moved to @google-cloud/firestore exports; import paths changed across versions.",
      affectedSymbols: ["Timestamp", "FieldValue", "GeoPoint"],
      breaking: false,
      evidence: { sdk: "google-cloud" },
    },
  ],
  patchSuggestions: {
    "require('google-cloud')": {
      replacement: "require('@google-cloud/<service>')",
      description:
        "Split google-cloud imports into per-service packages (storage, firestore, pubsub, etc.).",
      confidence: 90,
    },
    "import 'google-cloud'": {
      replacement: "import from '@google-cloud/<service>'",
      description: "Split the umbrella import into per-service package imports.",
      confidence: 90,
    },
  },
});
