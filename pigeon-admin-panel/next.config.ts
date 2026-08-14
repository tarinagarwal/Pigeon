import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for small, portable Docker images.
  output: "standalone",
};

export default nextConfig;
