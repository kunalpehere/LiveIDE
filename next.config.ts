import type { NextConfig } from "next";
import { avatarHosts, browserSecurityHeaders } from "./lib/browser-security";

const nextConfig: NextConfig = {
  // Framework development logs may contain action arguments, URL queries,
  // or raw browser errors. Application monitoring emits safe metadata instead.
  logging: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  images: {
    remotePatterns: avatarHosts.map(hostname => ({ protocol: "https" as const, hostname, port: "", pathname: "/**" })),
  },
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: browserSecurityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
