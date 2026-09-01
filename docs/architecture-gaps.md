# Architecture Gap-to-Scale — closure status

Full north-star: CONTRACT → API/EVENT/DATA → SDK (EXTERNAL+INTERNAL) → IMPACT GRAPH → CHANGE INTELLIGENCE → REMEDIATION (Plan/Patch/Refactor) → VALIDATION → GOVERNANCE → DELIVERY → OUTCOME → LEARNING LOOP

| Gap layer                                     | Status      | Shipped in                                                                                                                                                                                     |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API SOAP/WS** detached from generic-openapi | ✅ scaffold | `adapters/soap.ts:1` WSDL/AsyncAPI ETag adapters                                                                                                                                               |
| **EVENT** Kafka/MQTT/AMQP/NATS/Pub/Sub        | ✅ scaffold | `adapters/event.ts:1` stubs (WatchtowerAdapter, fetch no-op until broker URL)                                                                                                                  |
| **DATA** SQL/Mongo/Schema Registry            | ✅ scaffold | `adapters/data.ts:1` stubs + `diffSchemas` placeholder (mirrors `openapi-diff.ts:96`)                                                                                                          |
| **SDK EXTERNAL NuGet**                        | ✅ parser   | `repo-analysis/lockfile.ts:136` packages.lock.json/packages.config JSON+XML, `types.ts:49` `PackageManager=nuget`                                                                              |
| **SDK EXTERNAL Go**                           | ✅ parser   | `lockfile.ts:155` go.mod require blocks                                                                                                                                                        |
| **SDK EXTERNAL RubyGems**                     | ✅ parser   | `lockfile.ts:179` Gemfile.lock GEM specs                                                                                                                                                       |
| **SDK INTERNAL Go/Java/Mobile**               | 🟡 partial  | JS/TS/Python/Go/Java already; Mobile via `pb_agent_*` ingest `vendor-agent-ingest.md:1`                                                                                                        |
| **GOVERNED DELIVERY GitLab/Bitbucket**        | ✅ stubs    | `git-provider/gitlab-provider.ts:1` `bitbucket-provider.ts:1` implement GitProvider, `isAvailable false`, env factories; enum pending Prisma migration (`RepositoryProvider.GITLAB/BITBUCKET`) |
| **REMEDIATION Refactor**                      | 🟡 pending  | Plan/Patch shipped `remediation-engine/src/engine.ts:1`; Refactor requires corpus patchable entry per `docs/connector-certification.md:1`                                                      |
| **VALIDATION microVM**                        | 🟡 stub     | `sandbox-runner/src/index.ts:612` MicroVmSandboxRunner (probe false until Firecracker)                                                                                                         |
| **LEARNING LOOP**                             | 🟡 infra    | `operations/src/metrics.ts:1` + `evaluate-capability-health.ts:1` auto-suspend; needs >200 PrOutcomes before model                                                                             |

All gaps now have either a deterministic parser/adapter or a pluggable stub behind the existing interfaces (`WatchtowerAdapter`, `GitProvider`, `defineConnector`). No contract change needed to replace a stub with a real broker/schema registry.

Next physical migration: `packages/db/prisma/schema.prisma` add `GITLAB/BITBUCKET` to `RepositoryProvider` enum when GitLab/Bitbucket delivery is activated.
