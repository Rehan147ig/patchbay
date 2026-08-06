import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // bullmq/ioredis stay external (native requires in the Node runtime); bundling them
  // trips webpack on bullmq's optional @valkey/valkey-glide import.
  serverExternalPackages: ["bullmq", "ioredis"],
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
