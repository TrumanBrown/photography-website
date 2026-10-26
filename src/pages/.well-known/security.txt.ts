import type { APIRoute } from "astro";
import { securityTxt } from "@/lib/security-txt";
import { siteConfig } from "../../../site.config";

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL(`https://${siteConfig.domain}`);
  return new Response(securityTxt(origin, new Date()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
