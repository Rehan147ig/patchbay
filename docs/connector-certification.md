# Connector Certification — how to add the next DRAFT_PR

Current certified DRAFT_PR (5): `openai`, `stripe`, `twilio`, `anthropic`, `supabase` (`packages/vendor-connectors/src/capabilities.ts:136`). `aws-sdk`, `auth0`, `langchain` are intentionally `PLAN` — corpus has 0 patchable entries, so promoting them fails loudly by design (`packages/remediation-engine/src/eval-corpus.ts:611` `checkCertifiedPatchCoverage`).

Promoting without a patchable fixture is blocked. Do not bump `level` to `DRAFT_PR` without a green corpus.

## To certify the 6th/7th connector (self-serve via defineConnector)

1. **Scaffold connector** `packages/vendor-connectors/src/connectors/<slug>.ts`:

```ts
import { defineConnector } from "../sdk";
export const myConnector = defineConnector({
  slug: "my-vendor",
  identifiers: ["my-package"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "oldApi",
      newValue: "newApi",
      affectedSymbols: ["oldApi"],
      breaking: true,
      evidence: { sdk: "my-vendor" },
    },
  ],
  patchSuggestions: { oldApi: { replacement: "newApi", description: "...", confidence: 85 } },
});
```

Register in `packages/vendor-connectors/src/connectors/registry.ts` and `CAPABILITY_REGISTRY`.

2. **Fixture** `fixtures/repositories/<slug>-node-legacy/` with pinned `package.json` dependency (`^oldVersion`) + a file using `oldApi`.

3. **Corpus entry** `packages/remediation-engine/src/eval-corpus.ts:112` — add matched + unmatched pair:

```ts
{ id:"my-vendor-2.0.0", vendor:"my-vendor", fixture:"my-vendor-node-legacy", packageName:"my-package", releaseVersion:"2.0.0", previousVersion:"1.0.0", payload:{sdk:"my-vendor"}, expectedMatched:true, expectedFiles:["src/app.ts"], facts:{breaking:true,requiresHumanReview:true,riskTags:[]}, expectedDecision:PolicyDecision.REQUIRE_APPROVAL },
{ id:"my-vendor-1.0.0", vendor:"my-vendor", fixture:"my-vendor-node-legacy", packageName:"my-package", releaseVersion:"1.0.0", previousVersion:"0.9.0", payload:{fromVersion:"1.x",toVersion:"2.x"}, expectedMatched:false, expectedFiles:[], facts:{breaking:false,requiresHumanReview:false,riskTags:[]}, expectedDecision:PolicyDecision.ALLOW_PLAN_ONLY },
```

4. **Verify gates**:

```bash
pnpm test:corpus          # 100% recall/precision/validation gate
pnpm verify:python        # if pypi, also pyright
pnpm -r --parallel typecheck && pnpm lint
```

5. **Promote** `packages/vendor-connectors/src/capabilities.ts:136` `baseline → certified("my-vendor","my-package","DRAFT_PR")` — only after (4) is green. CI `checkCertifiedPatchCoverage` will enforce: DRAFT_PR must have `patchableEntries>0` and `violations=[]`; PLAN must have 0 suggestions.

## Why 7 DRAFT_PR is not just a bump

`aws-sdk-2.1691.0` and `langchain-0.1.0` are labeled `expectedFiles:[]` because their renames without imports fail the semantic gate (`TS2304`) — promoting them requires fixing the migration to produce valid TS (import insertion) and updating the corpus label, not just flipping `level`. Use the scaffold above for a net-new vendor (e.g. `vercel-ai-sdk`, `shopify`, `prisma`) instead.
