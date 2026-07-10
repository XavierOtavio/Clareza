import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clareza — Finanças pessoais",
    short_name: "Clareza",
    description: "Finanças pessoais e familiares sem ruído.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f5f1",
    theme_color: "#13231f",
    lang: "pt-PT",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
