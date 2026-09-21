import type { NextConfig } from "next";

/**
 * SmallCircles is a client-only app served by the Convex Static Hosting
 * component on convex.site, so it must be a static export.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
