// Worker entry. Phase 1 skeleton: responds to CORS preflight and a health
// check. The real validate -> extract -> cache pipeline lands in later phases.

import type { Env } from "./types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "GET") {
      return new Response("RecipeClip backend OK", { headers: CORS });
    }
    return new Response("Not implemented", { status: 501, headers: CORS });
  },
};
