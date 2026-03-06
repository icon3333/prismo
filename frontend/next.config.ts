import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8065/portfolio/api/:path*",
      },
      {
        source: "/auth/accounts",
        destination: "http://localhost:8065/api/accounts",
      },
      {
        source: "/auth/select/:id",
        destination: "http://localhost:8065/api/select_account/:id",
      },
    ];
  },
};

export default nextConfig;
