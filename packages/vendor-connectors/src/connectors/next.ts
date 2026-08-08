import { defineConnector } from "../sdk";

/**
 * Next.js connector.
 *
 * Next.js 13+ App Router changes that break existing Pages Router apps:
 * - `next/link` no longer requires an `<a>` child; the child can be text.
 * - `next/image` changed: `layout`/`objectFit` props removed, `fill` +
 *   `sizes` are the new model, and remote images need `remotePatterns`.
 * - `getServerSideProps`/`getStaticProps` still work in the Pages Router,
 *   but App Router server components replace them; `next/head` moved to
 *   `metadata` exports.
 * - `next.config.js` -> `next.config.ts`/`next.config.mjs` support and
 *   `experimental.appDir` was removed (stable in 13.4+).
 */
export const nextConnector = defineConnector({
  slug: "next",
  identifiers: ["next", "next.js", "nextjs"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "next/image layout prop",
      newValue: "fill + sizes",
      description:
        "Next.js 13 removed `layout` and `objectFit` props on next/image; use `fill` with `sizes` and CSS for object-fit.",
      affectedSymbols: ["next/image", "Image"],
      breaking: true,
      evidence: { sdk: "next" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "next/link <a> child",
      newValue: "text child",
      description:
        "Next.js 13 next/link no longer requires (and 14+ deprecates) wrapping children in an <a> tag; render text or a component directly.",
      affectedSymbols: ["next/link", "Link"],
      breaking: false,
      evidence: { sdk: "next" },
    },
    {
      changeType: "OTHER",
      oldValue: "next/head",
      newValue: "metadata export",
      description:
        "App Router replaced next/head with the `metadata` export (or `generateMetadata`); head tags inside a component no longer render.",
      affectedSymbols: ["next/head", "Head"],
      breaking: true,
      evidence: { sdk: "next" },
    },
  ],
  patchSuggestions: {
    "next/image": {
      replacement: "next/image (fill)",
      description:
        "Migrate next/image to the App Router model: remove layout/objectFit, add `fill` + `sizes`, configure `remotePatterns` in next.config.",
      confidence: 80,
    },
    "next/head": {
      replacement: "metadata",
      description:
        "Move page <Head> content into the `metadata` export (title, description, openGraph) in App Router pages.",
      confidence: 85,
    },
  },
});
