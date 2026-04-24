import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
      {
        source: "/manage-portfolios",
        destination: "http://localhost:8065/portfolio/manage_portfolios",
      },
      {
        source: "/csv-upload",
        destination: "http://localhost:8065/portfolio/upload",
      },
      {
        source: "/account/export",
        destination: "http://localhost:8065/account/export",
      },
      {
        source: "/auth/logout",
        destination: "http://localhost:8065/api/clear_account",
      },
    ];
  },
};

export default nextConfig;
