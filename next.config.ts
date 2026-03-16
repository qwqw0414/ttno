import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@google/adk", "jsdom", "@mozilla/readability"],
};

export default nextConfig;
