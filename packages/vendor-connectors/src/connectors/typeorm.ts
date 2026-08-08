import { defineConnector } from "../sdk";

/**
 * TypeORM connector.
 *
 * TypeORM 0.3 breaking changes:
 * - Imports moved: `getRepository` -> `AppDataSource.getRepository`,
 *   `createConnection` -> `new DataSource().initialize()`.
 * - Decorators moved from `typeorm` to `typeorm/decorator/*` (or
 *   `typeorm` re-export removed).
 * - `findOne` no longer accepts a string id; use `findOneBy`.
 * - `@PrimaryGeneratedColumn` uuid option changed.
 */
export const typeormConnector = defineConnector({
  slug: "typeorm",
  identifiers: ["typeorm"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "createConnection",
      newValue: "new DataSource().initialize()",
      description:
        "TypeORM 0.3 removed createConnection/getConnection; use AppDataSource.initialize() and getRepository.",
      affectedSymbols: ["createConnection", "getConnection", "getRepository", "getManager"],
      breaking: true,
      evidence: { sdk: "typeorm" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "findOne(id)",
      newValue: "findOneBy",
      description: "findOne no longer accepts a raw id; use findOneBy({ id }) or findOneByOrFail.",
      affectedSymbols: ["findOne", "findOneOrFail", "find"],
      breaking: true,
      evidence: { sdk: "typeorm" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "typeorm decorator imports",
      description:
        "Decorators moved to typeorm/decorator/* in 0.3; the typeorm umbrella re-export was removed.",
      affectedSymbols: ["@Entity", "@Column", "@PrimaryGeneratedColumn", "@ManyToOne"],
      breaking: true,
      evidence: { sdk: "typeorm" },
    },
  ],
  patchSuggestions: {
    createConnection: {
      replacement: "AppDataSource.initialize()",
      description:
        "Replace createConnection with a DataSource instance and initialize() + getRepository.",
      confidence: 90,
    },
    getRepository: {
      replacement: "AppDataSource.getRepository",
      description: "Use AppDataSource.getRepository(Entity) instead of the global getRepository.",
      confidence: 90,
    },
    findOne: {
      replacement: "findOneBy",
      description: "Replace findOne(id) with findOneBy({ id }); update where options accordingly.",
      confidence: 88,
    },
  },
});
