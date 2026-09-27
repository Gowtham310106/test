import type { MetadataRoute } from "next";

// Lets students add the app to their home screen and the shop install the
// dashboard like a desktop app (Chrome/Edge: "Install app").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Xerox",
    short_name: "Xerox",
    description: "Order your prints from class. Collect them when they're ready.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1f5eff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
