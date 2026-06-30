import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // Disable the service worker in dev so HMR / fast refresh stay clean.
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
});

const nextConfig: NextConfig = {
  // next-pwa injects a webpack config; an empty turbopack config lets `next dev`
  // run on Turbopack without conflict (the SW is disabled in dev anyway).
  turbopack: {},
};

export default withPWA(nextConfig);
