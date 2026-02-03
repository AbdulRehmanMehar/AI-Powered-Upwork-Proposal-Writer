import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  
  // Disable x-powered-by header for security
  poweredByHeader: false,
  
  // Enable strict mode for better development experience
  reactStrictMode: true,
  
  // Experimental features
  experimental: {
    // Optimize server components
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
