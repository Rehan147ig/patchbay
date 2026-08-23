# GROK HANDOFF — Patch UI/UX Change Log & Verification Guide

Purpose: verify recent work WITHOUT exploring the repo. Every changed file is listed below with its location and what "correct" looks like. Do not read files outside this list unless a check fails.

Repo: `C:\Users\SHAIK MOHAMMAD REHAN\patchbay` (Next.js 15 + pnpm monorepo)
State: local `main` == `origin/main` @ `ec27269`. All changes below are UNCOMMITTED (39 modified + 3 new files).

---

## 1. WHAT CHANGED (chronological)

### A. Branding sweep ("Patchbay" -> "Patch", user-facing only)

Internal identifiers (`@patchbay/*`, `PatchbayError`, `createPatchbayAdapter`, schema names, comments) intentionally remain "Patchbay".

| File                                                                                                                             | Change                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web/src/app/(dashboard)/login/page.tsx`                                                                                    | Copy says Patch                                                              |
| `apps/web/src/app/(dashboard)/settings/page.tsx`, `settings/github/page.tsx`                                                     | Copy says Patch                                                              |
| `apps/web/src/app/(dashboard)/changes/[id]/page.tsx`, `outcomes/page.tsx`, `overview/page.tsx`, `remediations/[id]/page.tsx`     | Copy says Patch                                                              |
| `apps/web/src/app/(dashboard)/onboarding/page.tsx`                                                                               | "Set up Patch" + launch-path subtitle                                        |
| `apps/web/src/components/onboarding-wizard.tsx`                                                                                  | Step labels/copy rewritten to real draft-PR path; amber SKIPPED!=PASSED note |
| `apps/web/src/app/api/remediations/[id]/validate/route.ts`                                                                       | SKIPPED message wording                                                      |
| `apps/worker/src/jobs/create-pr.ts`                                                                                              | PR title prefix `[Patch]`                                                    |
| `packages/git-provider/src/github-provider.ts`                                                                                   | Commit message `Apply Patch patch:`                                          |
| `packages/ai-provider/src/openai-compatible.ts` + `prompts/plan-draft.md`, `plan-generation.md`, `plan-review.md`                | Prompts say Patch                                                            |
| `docs/github-app-listing.md`, `docs/self-host.md`, `docs/deploy-railway.md`                                                      | Operator copy says Patch                                                     |
| Tests updated accordingly: `create-pr.test.ts`, `github-provider.test.ts`, `github-app-provider.test.ts`, `git-provider.test.ts` |

### B. Marketing site rebuild (final style = Elu-like: light, Inter, animated mockups)

| File                                                      | What correct looks like                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/globals.css`                            | Rewritten. `--font-sans` starts with `var(--font-inter)`. Tokens: ink-* (kept for dashboard orbs), accent-300..600, mint-300/400. Keyframes: float, marquee, marquee-reverse, drift, scanline, caret, rise-in, progress. Utilities: `.reveal`, `.reveal[data-visible="true"]`, `.scrollbar-none`. body = white/gray-900                                 |
| `apps/web/src/app/layout.tsx`                             | Inter via `next/font/google` (`variable: "--font-inter"`), `<body className={inter.variable} suppressHydrationWarning>`. Metadata default title "Patch"                                                                                                                                                                                                 |
| `apps/web/src/app/(marketing)/layout.tsx`                 | Light footer, gray palette                                                                                                                                                                                                                                                                                                                              |
| `apps/web/src/app/(marketing)/page.tsx`                   | Full rewrite: hero w/ masked grid + 3 `animate-drift` blobs, badge pill, headline with ONE gradient text span, pill CTAs, `<HeroMockup/>`, `<VendorLogoWall/>`, features grid wrapped in `<Reveal>` + hover shadow, `#how-it-works` contains `<PipelineShowcase/>`, support-matrix table (light), pricing (accent ring on Pro), final CTA w/ drift glow |
| `apps/web/src/components/marketing/marketing-nav.tsx`     | Server component (no "use client"). Sticky `bg-white/75 backdrop-blur-xl`, links inside rounded-full bordered pill track, CTA `bg-gray-900 ... rounded-full`                                                                                                                                                                                            |
| `apps/web/src/components/marketing/hero-mockup.tsx`       | NEW. Browser-chrome dashboard: sidebar, 3 stat tiles, live case ticker using `animate-feed` (pure CSS loop, rows h-7 x5 duplicated first row), two `animate-float` chips, embeds `<DiffWindow/>` overlapping bottom (-mt-10/-mt-14)                                                                                                                     |
| `apps/web/src/components/marketing/diff-window.tsx`       | GitHub-style light diff: del=bg-red-50/red-700, add=bg-emerald-50/emerald-700, ctx=gray-500; emerald validation pill; footer chips; root div is `relative w-full` (no margin — parent controls spacing)                                                                                                                                                 |
| `apps/web/src/components/marketing/vendor-logos.tsx`      | NEW. Two rows: ROW_A (OpenAI, stripe, twilio, Anthropic, aws), ROW_B (supabase, Auth0, Google Cloud, MongoDB, SendGrid). Opposing marquees (`animate-marquee` vs `animate-marquee-reverse`), inline geometric `VendorMark` SVGs, gray->brand color on hover via `--brand` css var, edge fade mask                                                       |
| `apps/web/src/components/marketing/pipeline-showcase.tsx` | NEW "use client". Auto-cycles Detect(0)->Patch(1)->Review(2) every 3400ms; `tick` state remounts stage visuals so staggered `rise-in` animations replay; pause on hover; clickable steps; thin progress bar animated via `progress` keyframe; DetectVisual=dark terminal + scanline, PatchVisual=diff lines + caret, ReviewVisual=PR card checks        |
| `apps/web/src/components/marketing/reveal.tsx`            | Recreated IntersectionObserver fade-up wrapper (was deleted during minimal pass, restored for Elu pass)                                                                                                                                                                                                                                                 |
| DELETED                                                   | `apps/web/src/components/marketing/vendor-marquee.tsx` (old dark marquee — intentional deletion, do not restore)                                                                                                                                                                                                                                        |
| DELETED                                                   | `apps/web/src/components/marketing/vendor-strip.tsx` existed mid-session, replaced by vendor-logos.tsx — if present anywhere it is stale                                                                                                                                                                                                                |

### C. Dashboard systemic restyle (shared primitives — affects ALL dashboard pages)

| File                                                              | What correct looks like                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/card.tsx`                                        | Card: `rounded-xl border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)]`; CardHeader/Content px-5 py-4; StatCard label uppercase tracking-wider text-[11px], value `text-3xl font-semibold tabular-nums`, hover shadow lift |
| `packages/ui/src/table.tsx`                                       | Wrapper rounded-xl border-gray-200; head `bg-gray-50/80 text-[11px] uppercase tracking-wider`; cells px-4 py-2.5; row hover gray-50/70                                                                                    |
| `packages/ui/src/button.tsx`                                      | rounded-lg; primary `bg-gray-900 hover:bg-gray-700`; sm=px-3 py-1.5, md=px-4 py-2                                                                                                                                         |
| `packages/ui/src/badge.tsx`, `status-pill.tsx`, `empty-state.tsx` | slate-* -> gray-* sweep; empty-state rounded-xl                                                                                                                                                                           |
| `apps/web/src/components/nav.tsx`                                 | Pill track: container `rounded-full border border-gray-200/80 bg-white/90 p-1 scrollbar-none overflow-x-auto`; active link `bg-gray-900 text-white rounded-full shadow-sm`                                                |
| `apps/web/src/app/(dashboard)/layout.tsx`                         | Canvas `bg-gray-50/50`; sticky glass header `bg-white/75 backdrop-blur-xl border-gray-200/70`; logo square `bg-gray-900 rounded-lg`; main `max-w-7xl py-8`                                                                |
| `apps/web/src/app/(dashboard)/overview/page.tsx`                  | h1 `text-2xl tracking-tight`, stat grid gap-5, audit link `text-accent-600`, "Next steps" rebuilt as arrow-hover link rows                                                                                                |

### D. Misc fixes

- Hydration console error fix: `suppressHydrationWarning` on `<body>` (root cause = user's Bing-type browser extension injecting `bis_skin_checked` attrs; NOT a code bug).
- `dev-server.log`, `ast-run.log/.err` are throwaway logs — safe to delete, do not commit.

## 2. REFERENCE ARTIFACTS (do not modify, do not commit)

- `graphify-out/` — knowledge graph of codebase (graph.json 3395 nodes / 8213 edges, GRAPH_REPORT.md, graph.html). Useful for impact queries; generated via graphify CLI + 64-bit Python.
- Demo login: `demo@patchbay.dev` / `dev-only` (Docker Desktop must be running; `docker compose up -d` then `pnpm db:migrate && pnpm db:seed` if DB fresh).

## 3. VERIFICATION PROMPTS (run these, in order)

### Prompt 1 — static bar

```
cd C:\Users\SHAIK MOHAMMAD REHAN\patchbay
pnpm format ; pnpm lint ; pnpm typecheck
```

Expected: all three exit clean, zero warnings. If lint fails, fix in the exact files listed above; do not refactor unrelated code.

### Prompt 2 — tests (stop any running `pnpm dev` first; Docker Desktop running)

```
pnpm test
```

Expected: 95 files passed, 1016 passed, 7 skipped. If Docker is down: 7 skip AND sandbox-runner timeout test may flake under load — rerun the failing file alone before investigating:

```
pnpm vitest run packages/sandbox-runner/src/sandbox-runner.test.ts packages/operations/src/retention.test.ts apps/worker/src/lib/case-funnel.test.ts
```

Route tests under `apps/web/src/app/api/**/[id]/**` are excluded by default glob; if you touch one: `pnpm vitest run --config vitest.wp10.config.ts`.

### Prompt 3 — marketing page smoke

Start dev server (`pnpm dev`), open http://localhost:3000, verify ONLY these:

1. Inter font renders (html tag carries a `__variable_` class)
2. Hero: grid fades near edges, 3 blobs drift slowly, dashboard mockup ticker scrolls forever, 2 chips bob
3. Logo wall: two rows scroll OPPOSITE directions, names turn brand-colored on hover
4. How-it-works: cycles Detect->Patch->Review ~every 3.4s, restarts animations each cycle, pauses while hovered, steps clickable
5. Console: no hydration errors mentioning our components (`bis_skin_checked` warnings = user's browser extension, ignorable)

### Prompt 4 — dashboard smoke

Sign in at /login (demo@patchbay.dev / dev-only), open /overview:

1. Glass sticky header + pill nav, active item = solid dark pill
2. Stat cards: big tabular numbers, hover lift
3. Tables: compact gray header rows
4. Buttons: rounded-lg dark primary
   Spot-grep (should return NOTHING in marketing dir): `bg-gradient-to-r from-accent-500 to-accent-600` inside `apps/web/src/app/(marketing)` (buttons must be flat pills now).

### Prompt 5 — known-intentional states (do NOT "fix")

1. `ink-*` tokens still exist in globals.css although marketing no longer uses them — required by `components/agent-orbs-panel.tsx`
2. `suppressHydrationWarning` on body — deliberate
3. `vendor-marquee.tsx` absence — deliberate
4. Remaining "Patchbay" strings in imports/error classes/comments — deliberate internal naming
5. `dynamic = "force-dynamic"` in both layouts — pre-existing architecture, leave alone

## 4. OPEN ARCHITECTURE DECISION — scan transport at scale (GROK: give your opinion, see Prompt 6)

### The problem

Every scan currently does a cold network fetch of repo content into a disposable workspace:

- `packages/git-provider/src/local-provider.ts` line ~174: `git clone --depth 1 <url> <workspace>`
- `packages/git-provider/src/github-provider.ts` line ~129: `git fetch --depth 1 origin <sha>` + SHA verification

Depth-1 avoids history download but NOT the tree+blob snapshot. One enterprise monorepo = GBs per scan, re-downloaded every time, egress billed to the CUSTOMER's forge, Patch visible as a high-traffic neighbor. Fine at demo scale (today), breaks at pilot/scale (Cursor's "Git at any scale" blog documents this exact traffic pattern killing GitHub's Spokes; their fix treats repos as a warm cache).

### Hard constraint (product promise, not preference)

Patch stores ZERO customer source code at rest. Scan flow today: clone -> temp dir -> AST extract -> facts to Postgres -> delete dir. DB holds only metadata (GraphSnapshot/GraphNode/GraphEdge, hashes, impact rows). This is a compliance/security selling point and must be weighed heavily in any remedy.

### Option A — Event-driven incremental fetch (webhook changedFiles splice)

On push webhook, GitHub payload lists changed files. Fetch ONLY those blobs via API, run the existing incremental re-extraction (`packages/repo-analysis/src/incremental-corpus.test.ts` already proves changedFiles-mode equals a clean full extraction), splice into the stored GraphSnapshot.

- Pros: zero code at rest preserved (blobs touched ephemerally in-memory/temp); minimal forge load (KBs instead of GBs); faster scans; aligns with watchtower/webhooks already wired.
- Cons: most engineering effort (blob fetch path + snapshot splice + edge invalidation for reverse importers — note the corpus test proves reverse-importer correctness exists); depends on webhook delivery (need catch-up reconciliation on missed events); first-scan still needs one full clone.

### Option B — Persistent encrypted mirror cache on workers

`git clone --mirror` once per repo on worker disk, TTL/purge policy, incremental `git fetch` (delta packs) per scan, materialize disposable worktrees from mirror.

- Pros: simplest to build; fastest repeat scans (local disk); delta fetches are tiny after warm-up; no webhook dependency.
- Cons: BREAKS zero-code-at-rest — full source sits on our disks between scans. Enterprise security reviews will flag it (multi-tenant worker disks holding tenant source = isolation/encryption/purge policy burden). Also per-worker storage growth with repo count.

### Current internal position

A is preferred for the long run specifically BECAUSE of the constraint B violates: our wedge is enterprise trust/governance, and "the remediation tool that never archives your code" is a moat, not a limitation. Cost: more engineering now or later. Hybrid worth noting: A for steady-state updates, one full clone only on first connect or after long drift.

### DECISION LOG — 2026-08-23, independently concurred by Grok 4.5

- **Pick: Option A** (event-driven incremental fetch) + one full ephemeral clone on first connect / forced reconcile. **B rejected** as default — burns the zero-source-at-rest trust claim in enterprise review.
- Rationale: (1) trust is the wedge; (2) the hard part is already paid for — `incremental-corpus` proves changedFiles merge == full extract incl. reverse importers + lockfile invalidation, missing piece is transport only; (3) forge egress is the real scale cliff.
- Biggest risk of A: **webhook drift** (missed/out-of-order pushes, truncated changedFiles, force-push). Required mitigations when built: delivery idempotency, SHA watermark on GraphSnapshot, periodic full reconcile (nightly or after N increments / on hash mismatch), lockfile change -> full re-extract (already covered by corpus).
- **Implementation trigger** — not before the first real draft-PR launch proof; then ANY of: connected repo > ~200–500 MB or scan wall-time / GitHub secondary-rate-limit pain; > ~50 active repos or high push volume on one install; or a design partner's security questionnaire asks "do you store our source?".
- Until then: keep cold shallow clone, documented as known debt.

### Prompt 6 — GROK: independent opinion required

Evaluate Option A vs Option B vs any third design you consider better, strictly for THIS codebase (Next.js web + BullMQ worker + Prisma/Postgres + GitProvider abstraction, GitHub-first). Judge on: (1) long-term enterprise viability, (2) engineering cost given existing incremental-corpus machinery, (3) operational risk (missed webhooks, drift), (4) consistency with the zero-code-at-rest promise. Reply with: your pick, 3 strongest reasons, biggest risk of your pick, and under what trigger we should implement (customer count? repo size threshold? scan volume?). Do NOT implement anything — opinion only.

## 5. ENVIRONMENT QUIRKS (ignore, do not debug)

- `next build` prints SWC DLL init warning — pre-existing machine quirk; build still compiles (~21s).
- This Windows shell alternates cmd.exe / PowerShell 5.1 semantics; prefer plain single commands or `.cmd` script files over chained one-liners.
- `python` on PATH is 32-bit (breaks native wheels); use `py -V:3.13` or full path to `...\Python313\python.exe` (64-bit).
- If asked about scaling debt: per-scan cold shallow clone (`local-provider.ts:174`, `github-provider.ts:129`) is a KNOWN logged decision — remedy chosen = event-driven incremental fetch (webhook changedFiles), NOT persistent mirrors (preserves zero-code-at-rest promise).
