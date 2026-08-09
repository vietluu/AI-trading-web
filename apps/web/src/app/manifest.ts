import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AI Trading Research",
    short_name: "AI Trading",
    description:
      "Multi-agent cryptocurrency futures research and risk-controlled trading intelligence.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#07111f",
    orientation: "any",
    categories: ["finance", "business", "productivity"],
    icons: [
      {
        src: "/icon.jpg",
        sizes: "1024x1024",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Market intelligence",
        short_name: "Market",
        description: "Open live market intelligence",
        url: "/market",
        icons: [{ src: "/icon.jpg", sizes: "1024x1024", type: "image/jpeg" }],
      },
      {
        name: "Live trading",
        short_name: "Trading",
        description: "Open the live trading workspace",
        url: "/live-trading",
        icons: [{ src: "/icon.jpg", sizes: "1024x1024", type: "image/jpeg" }],
      },
    ],
  };
}
