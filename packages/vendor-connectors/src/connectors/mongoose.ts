import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Mongoose connector.
 *
 * Mongoose 7+ / 8 breaking changes that hit real apps:
 * - Callbacks are removed; every query/model method returns a promise
 *   (`.exec()` still exists but callbacks like `.then`-less usage break).
 * - `Model.remove()` was removed in Mongoose 7 (use `deleteOne`/`deleteMany`).
 * - `findByIdAndUpdate` etc. no longer cast unknown paths by default.
 */
export const mongooseConnector = defineConnector({
  slug: "mongoose",
  identifiers: ["mongoose"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "Model.remove()",
      newValue: "Model.deleteOne()/deleteMany()",
      description: "Mongoose 7 removed `Model.remove()`; use `deleteOne()` or `deleteMany()`.",
      affectedSymbols: ["Model.remove"],
      breaking: true,
      evidence: { sdk: "mongoose", riskTag: RiskTag.OTHER },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "Model.count()",
      newValue: "Model.countDocuments()",
      description:
        "Mongoose 6 deprecated `Model.count()`; use `countDocuments()` (removed in later versions).",
      affectedSymbols: ["Model.count"],
      breaking: true,
      evidence: { sdk: "mongoose" },
    },
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "findByIdAndUpdate(filter, update)",
      newValue: "findByIdAndUpdate(filter, update, { new: true })",
      description:
        "Mongoose no longer returns the updated doc by default; pass `{ new: true }` to get the post-update document.",
      affectedSymbols: ["Model.findByIdAndUpdate", "Model.findOneAndUpdate"],
      breaking: false,
      evidence: { sdk: "mongoose" },
    },
  ],
  patchSuggestions: {
    "Model.remove": {
      replacement: "Model.deleteMany",
      description: "Replace `Model.remove(query)` with `Model.deleteMany(query)` (Mongoose 7+).",
      confidence: 95,
    },
    "Model.count": {
      replacement: "Model.countDocuments",
      description: "Replace `Model.count()` with `Model.countDocuments()` (Mongoose 6+).",
      confidence: 95,
    },
    "Model.findByIdAndUpdate": {
      replacement: "Model.findByIdAndUpdate",
      description:
        "Ensure `findByIdAndUpdate` passes `{ new: true }` so the returned doc is the updated one.",
      confidence: 75,
    },
  },
});
