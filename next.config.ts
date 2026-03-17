import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@google/adk",
    "jsdom",
    "@mozilla/readability",
    "puppeteer",
    "puppeteer-core",
  ],
};

export default nextConfig;
