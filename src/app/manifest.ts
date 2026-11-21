import type { MetadataRoute } from "next";
import { APP_NAME, appIcons } from "@/lib/app-brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "A portable register for counter sales.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#151515",
    icons: [
      {
        src: appIcons.small,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: appIcons.large,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
