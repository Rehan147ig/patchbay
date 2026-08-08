import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Firebase Admin / JS SDK connector.
 *
 * Covers the breaking changes that hit most Firebase apps:
 * - `firebase-admin` v10+ changed `firestore()` field paths and removed
 *   `admin.messaging().sendToDevice` (v11 removed legacy FCM APIs).
 * - `FieldValue.arrayUnion` etc. still work, but `Timestamp` moved to
 *   `@google-cloud/firestore`.
 * - The modular v9+ JS SDK (`getFirestore`, `collection`...) replaced the
 *   namespaced `firebase.firestore()` API.
 */
export const firebaseConnector = defineConnector({
  slug: "firebase",
  identifiers: ["firebase", "firebase-admin", "firebase-admin/*", "@firebase/*"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "admin.messaging().sendToDevice",
      newValue: "getMessaging().sendEachForMulticast",
      description:
        "firebase-admin v11 removed legacy FCM send APIs; use `sendEachForMulticast` (or `send`) with the new token-message shape.",
      affectedSymbols: ["sendToDevice", "sendToDeviceGroup", "sendMulticast"],
      breaking: true,
      evidence: { sdk: "firebase", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "firebase.firestore()",
      newValue: "getFirestore()",
      description:
        "Firebase JS SDK v9+ replaced the namespaced `firebase.firestore()` with the modular `getFirestore()`.",
      affectedSymbols: ["firebase.firestore", "firebase.auth", "firebase.storage"],
      breaking: true,
      evidence: { sdk: "firebase" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "FieldValue.serverTimestamp()",
      description:
        "Firestore still supports serverTimestamp(), but the import moved: it now comes from the modular `firebase/firestore` (or @google-cloud/firestore) export.",
      affectedSymbols: ["FieldValue.serverTimestamp", "FieldValue.arrayUnion"],
      breaking: false,
      evidence: { sdk: "firebase" },
    },
  ],
  patchSuggestions: {
    sendToDevice: {
      replacement: "sendEachForMulticast",
      description:
        "Replace legacy FCM `sendToDevice`/`sendMulticast` with `sendEachForMulticast` (firebase-admin v11+).",
      confidence: 90,
    },
    "firebase.firestore": {
      replacement: "getFirestore",
      description:
        "Replace `firebase.firestore()` with the modular `getFirestore()` import from 'firebase/firestore' (v9+).",
      confidence: 88,
    },
  },
});
