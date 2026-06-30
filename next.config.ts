import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Use the system trust store when fetching Google Fonts at build time.
    // Without this, `next build` fails with a TLS error reaching fonts.gstatic.com.
    turbopackUseSystemTlsCerts: true,
  },
};

export default nextConfig;
