import type { ChangeType } from "@patchbay/domain";
import type { NormalizedChangeDraft, PatchSuggestion } from "@patchbay/vendor-connectors";
import type { PlanUsage } from "./types";

/**
 * Repair surface: which facet of the vendor contract broke.
 *
 * Detection stays interconnected (one graph, one pipeline), but remediation
 * routes per surface: an API break must not rewrite SDK symbols, and a
 * webhook break must not touch API call sites. `unclassified` preserves the
 * legacy engine behavior for inputs that carry no surface signal (notably
 * `OTHER` change types and usages no normalization references).
 */
export const REPAIR_SURFACES = ["sdk", "api", "webhook", "unclassified"] as const;
export type RepairSurface = (typeof REPAIR_SURFACES)[number];

/**
 * Deterministic ChangeType -> surface mapping. Derived from what each change
 * class names: METHOD renames/removals and SDK version upgrades move package
 * symbols; RESPONSE, ENDPOINT, PARAMETER and AUTH changes describe HTTP
 * contract behavior; WEBHOOK_CHANGE describes event payloads. OTHER carries
 * no signal on purpose: connectors must use a precise type to earn a lane.
 */
export function surfaceOfChangeType(changeType: ChangeType): RepairSurface {
  switch (changeType) {
    case "SDK_VERSION_UPGRADE":
    case "METHOD_RENAMED":
    case "METHOD_REMOVED":
      return "sdk";
    case "PARAMETER_RENAMED":
    case "PARAMETER_REMOVED":
    case "PARAMETER_REQUIRED":
    case "RESPONSE_FIELD_REMOVED":
    case "RESPONSE_FIELD_TYPE_CHANGED":
    case "ENDPOINT_REMOVED":
    case "AUTH_CHANGE":
    case "NEW_CAPABILITY":
      return "api";
    case "WEBHOOK_CHANGE":
      return "webhook";
    case "OTHER":
      return "unclassified";
  }
}

/**
 * Usage-level surface hint from the indexed construct. Only the unambiguous
 * constructs decide here: a WEBHOOK usage is a handler/validator by
 * definition, an ENDPOINT_CALL is direct HTTP. Everything else (imports,
 * method calls, configs) falls through to the normalization link, because the
 * same call shape can be SDK- or API-driven depending on the change.
 */
export function surfaceOfUsageType(usageType: string | undefined): RepairSurface | null {
  if (usageType === "WEBHOOK") return "webhook";
  if (usageType === "ENDPOINT_CALL") return "api";
  return null;
}

export interface SurfaceAttribution {
  /** Surfaces present in the change input (from normalizations), in lane order. */
  activeSurfaces: RepairSurface[];
  /** Lane membership per usage index: a usage can belong to several lanes. */
  usageLanes: Map<number, Set<RepairSurface>>;
  /** Lane membership per suggestion symbol. Unlinked symbols stay unclassified. */
  suggestionLanes: Map<string, Set<RepairSurface>>;
  /** Files with at least one usage in the given lane. */
  filesByLane: Map<RepairSurface, Set<string>>;
  /**
   * Files whose text contains an API normalization's affected symbol even
   * though no usage points at it (e.g. `completion.data` read on a line
   * indexed under the SDK call symbol). These files genuinely participate in
   * the API surface and must receive API-lane rules.
   */
  apiTextFiles: Set<string>;
  /** Usage members plus text-matched files, per lane (for outcome reporting). */
  involvedCountByLane: Map<RepairSurface, number>;
}

/**
 * Attributes every usage and suggestion to repair lanes. Union semantics: a
 * symbol referenced by several surfaces' normalizations belongs to each of
 * those lanes. Members of no lane fall into `unclassified`, which preserves
 * the pre-lane engine behavior exactly (no silent drops).
 *
 * `readFile` (relative path -> content, null when unreadable) enables the
 * API text match: response-shape symbols live on lines indexed under other
 * symbols, so symbol linkage alone under-attributes. Only API
 * normalizations drive text matching — SDK rules are symbol-targeted and the
 * webhook lane has no text rules yet. Substring matching is deliberate: the
 * engine's own rewrite rules operate on the same dotted-symbol text, so a
 * file that cannot match the rewrite cannot be wrongly laned by it either.
 */
export function attributeSurfaces(args: {
  usages: PlanUsage[];
  patchSuggestions: PatchSuggestion[];
  normalizations: NormalizedChangeDraft[];
  readFile?: (filePath: string) => string | null;
}): SurfaceAttribution {
  const { usages, patchSuggestions, normalizations, readFile } = args;

  const symbolSurfaces = new Map<string, Set<RepairSurface>>();
  const addSymbolSurface = (symbol: string, surface: RepairSurface): void => {
    const set = symbolSurfaces.get(symbol) ?? new Set<RepairSurface>();
    set.add(surface);
    symbolSurfaces.set(symbol, set);
  };
  const apiSymbols: string[] = [];
  for (const normalization of normalizations) {
    const surface = surfaceOfChangeType(normalization.changeType);
    for (const symbol of normalization.affectedSymbols) addSymbolSurface(symbol, surface);
    if (surface === "api") apiSymbols.push(...normalization.affectedSymbols);
  }

  const suggestionLanes = new Map<string, Set<RepairSurface>>();
  for (const suggestion of patchSuggestions) {
    suggestionLanes.set(
      suggestion.symbol,
      new Set(symbolSurfaces.get(suggestion.symbol) ?? ["unclassified"]),
    );
  }

  const usageLanes = new Map<number, Set<RepairSurface>>();
  const filesByLane = new Map<RepairSurface, Set<string>>();
  const involvedCountByLane = new Map<RepairSurface, number>();
  const touch = (lane: RepairSurface): void => {
    involvedCountByLane.set(lane, (involvedCountByLane.get(lane) ?? 0) + 1);
  };
  usages.forEach((usage, index) => {
    const lanes = new Set<RepairSurface>(symbolSurfaces.get(usage.symbol) ?? []);
    const hinted = surfaceOfUsageType((usage as { usageType?: string }).usageType);
    if (hinted) lanes.add(hinted);
    if (lanes.size === 0) lanes.add("unclassified");
    usageLanes.set(index, lanes);
    for (const lane of lanes) {
      const set = filesByLane.get(lane) ?? new Set<string>();
      set.add(usage.filePath);
      filesByLane.set(lane, set);
      touch(lane);
    }
  });

  const apiTextFiles = new Set<string>();
  if (readFile && apiSymbols.length > 0) {
    const candidates = new Set<string>(usages.map((usage) => usage.filePath));
    for (const filePath of candidates) {
      const content = readFile(filePath);
      if (content === null) continue;
      if (apiSymbols.some((symbol) => content.includes(symbol))) {
        apiTextFiles.add(filePath);
        const set = filesByLane.get("api") ?? new Set<string>();
        set.add(filePath);
        filesByLane.set("api", set);
        touch("api");
      }
    }
  }

  const active = new Set<RepairSurface>();
  for (const normalization of normalizations)
    active.add(surfaceOfChangeType(normalization.changeType));
  const activeSurfaces = REPAIR_SURFACES.filter((surface) => active.has(surface));

  return {
    activeSurfaces,
    usageLanes,
    suggestionLanes,
    filesByLane,
    apiTextFiles,
    involvedCountByLane,
  };
}
