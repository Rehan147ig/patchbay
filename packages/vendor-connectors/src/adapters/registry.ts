import type { WatchtowerAdapter } from "../watchtower";
import { createAllNpmAdapters } from "../adapters/npm";
import { createAllGitHubReleasesAdapters } from "../adapters/github-releases";
import { createOpenAPIAdapters } from "../adapters/openapi";

let cachedAdapters: WatchtowerAdapter[] | null = null;

export function getWatchtowerAdapters(): WatchtowerAdapter[] {
  if (cachedAdapters) return cachedAdapters;
  cachedAdapters = [
    ...createAllNpmAdapters(),
    ...createAllGitHubReleasesAdapters(),
    ...createOpenAPIAdapters(),
  ];
  return cachedAdapters;
}

export function getWatchtowerAdapter(slug: string): WatchtowerAdapter | undefined {
  return getWatchtowerAdapters().find((a) => a.slug === slug);
}

export function getAdaptersBySource(source: string): WatchtowerAdapter[] {
  return getWatchtowerAdapters().filter((a) => a.source === source);
}

export function resetWatchtowerAdapterCache(): void {
  cachedAdapters = null;
}
