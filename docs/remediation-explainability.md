# Remediation Explainability (P1-8)

Every remediation produced by Patchbay is explainable end-to-end. No black-box PRs.

## Chain of evidence

| Step                   | Data                                                                | Source                                                              | Storage                                                                   | UI                                                       |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Source event           | `VendorChangeEvent` / `ContractChange` raw payload, vendor, version | `packages/vendor-connectors` adapters + `ingestContractSnapshot`    | `ContractSource`→`ContractSnapshot`→`ContractChange`, `VendorChangeEvent` | `/changes/[id]`, `/cases/[id]` timeline                  |
| Old/new contract       | `contentHash`/`normalizedHash`, diff                                | `canonicalJson` + `mcp-diff.ts`                                     | `ContractSnapshot`, `ContractChange.evidenceJson`                         | Change detail diff breakdown                             |
| Affected symbols/repos | `IntegrationUsage` + `ImpactAssessment` blast radius                | `packages/repo-analysis` extractors, `computeBlastRadius`           | `IntegrationUsage`, `ImpactAssessment.blastRadiusJson`                    | `/repositories/[id]`, case blast radar, overview queue   |
| Rule/model rationale   | `rulePack` id, `corpus` metrics, agent plan                         | `packages/vendor-connectors/capabilities.ts`, `packages/ai-harness` | `RemediationPlan.strategy`, `AgentRun`                                    | Case plan tab + PR body machine block                    |
| Exact diff             | `PatchArtifact.unifiedDiff`                                         | `packages/remediation-engine`                                       | `PatchArtifact`                                                           | PR diff + `/remediations/[id]`                           |
| Validation             | commands, stdout/stderr, exitCode, `ValidationArtifact` hash        | `packages/sandbox-runner`                                           | `ValidationRun` + `ValidationArtifact` + evidence store                   | Case validation logs + PR evidence block                 |
| Policy decision        | `evaluatePolicy` decision + reasons, quorum                         | `packages/policy-engine`                                            | `PolicyDecisionRecord` (WP5) + `PR body`                                  | Case policy section + Operations gates                   |
| Approver               | `Approval` decision, hash-bound, 7-day TTL                          | `approvalCoversPatches`                                             | `Approval` + `RemediationPlan.approvals`                                  | Case approvers + audit trail                             |
| Delivery               | `DeliveryAttempt` ledger, `PullRequest`                             | `apps/worker/src/jobs/create-pr.ts`                                 | `DeliveryAttempt`, `PullRequest`                                          | PR delivery link with `<!-- patchbay:evidence {...} -->` |

## Machine-readable evidence block

Every PR body carries `<!-- patchbay:evidence {...canonical JSON...} -->` (P1-9, WP12). Customer tooling can audit without parsing prose.

## Verification

- `packages/domain/src/delivery-evidence.test.ts` — round-trip + tamper tests
- `apps/worker/src/lib/wp13-drills.test.ts` — full-loop drill asserts evidence hash round-trips through content addressing
- `docs/capability-matrix.md` generated — every connector states its level, no silent promotion
