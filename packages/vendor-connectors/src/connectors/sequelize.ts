import { defineConnector } from "../sdk";

/**
 * Sequelize connector.
 *
 * Sequelize v6 -> v7 breaking changes:
 * - `Model.findOrCreate`, `findAll` etc. where/order signatures changed.
 * - `sequelize.define` vs class-based `Model.init` — the class approach
 *   is canonical.
 * - v7 removed `operatorsAliases`, changed `Model.findOne` returns
 *   (null vs undefined), and moved types to `sequelize` directly.
 */
export const sequelizeConnector = defineConnector({
  slug: "sequelize",
  identifiers: ["sequelize", "sequelize-typescript"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "operatorsAliases",
      description:
        "Sequelize v7 removed operatorsAliases; use symbolic operators ($and, $or) only.",
      affectedSymbols: ["new Sequelize", "sequelize"],
      breaking: true,
      evidence: { sdk: "sequelize" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "findOne return",
      description:
        "findOne/findByPk return null (not undefined) on no result in v7; code checking truthiness is fine but type-checks break.",
      affectedSymbols: ["findOne", "findByPk", "findAll"],
      breaking: true,
      evidence: { sdk: "sequelize" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "Model.bulkCreate / upsert",
      description: "Bulk operation signatures changed across v6->v7 (options, returning).",
      affectedSymbols: ["bulkCreate", "upsert", "findOrCreate"],
      breaking: true,
      evidence: { sdk: "sequelize" },
    },
  ],
  patchSuggestions: {
    "new Sequelize": {
      replacement: "new Sequelize",
      description:
        "Remove operatorsAliases from the Sequelize constructor (v7) and use symbolic operators.",
      confidence: 85,
    },
    findOne: {
      replacement: "findOne",
      description: "Handle null returns from findOne/findByPk (v7 returns null, not undefined).",
      confidence: 80,
    },
  },
});
