import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monark Sales Intelligence",
    short_name: "Monark Sales",
    description: "Lead, visit, inventory and conversion operations for Monark.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f8f7f3",
    theme_color: "#17322d",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
