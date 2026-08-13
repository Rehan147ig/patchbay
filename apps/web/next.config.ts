import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // bullmq/ioredis stay external (native requires in the Node runtime); bundling them
  // trips webpack on bullmq's optional @valkey/valkey-glide import. The @patchbay/*
  // workspace packages stay external too: they are plain JS CommonJS/ESM packages whose
  // server entry points (e.g. @patchbay/domain logger) import node: builtins that
  // webpack cannot bundle ("Unhandled scheme" errors).
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "@patchbay/db",
    "@patchbay/domain",
    "@patchbay/audit",
    "@patchbay/queue",
    "@patchbay/repo-analysis",
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@valkey/valkey-glide": false,
    };
    return config;
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
