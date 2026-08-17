import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FAST SOCIO",
    short_name: "Socio",
    description:
      "The university-exclusive social platform for FAST NUCES students.",
    // Explicit identity. Absent, an install is identified by start_url, which
    // works but leaves the app's identity implicit — and this app has just
    // moved origin, which is exactly the situation where implicit identity is
    // worth removing. "/" resolves against the serving origin, so this pins the
    // installed app to fastsocio.online and matches what installs already made
    // from this origin resolved to (no re-identification for existing users).
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0B10",
    theme_color: "#0A0B10",
    categories: ["social", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
