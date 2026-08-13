import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for small, portable Docker images.
  output: "standalone",
  // Serve modern, smaller formats for next/image (helps "Improve image delivery").
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // Tree-shake large icon/UI barrels so only used exports ship
  // (reduces unused + legacy JavaScript and main-thread work).
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-navigation-menu",
    ],
  },
};

export default nextConfig;
