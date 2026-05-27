import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-source",
};

const BACKEND = "https://salman894552-lumexav8.hf.space";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, material = "auto" } = await req.json();
    if (!prompt) throw new Error("prompt required");

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    let stl: ArrayBuffer | null = null;
    let source = "template";
    let lastError = "";

    // Try 1: /generate-from-prompt (Gemini-authored CadQuery)
    if (geminiKey) {
      try {
        const form = new URLSearchParams();
        form.set("prompt", prompt);
        form.set("gemini_api_key", geminiKey);
        form.set("material", material);
        const r = await fetch(`${BACKEND}/generate-from-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        const ct = r.headers.get("content-type") || "";
        if (r.ok && ct.includes("octet-stream")) {
          stl = await r.arrayBuffer();
          source = "gemini";
        } else {
          lastError = await r.text();
          console.warn("generate-from-prompt failed:", r.status, lastError.slice(0, 200));
        }
      } catch (e) {
        lastError = String(e);
        console.warn("generate-from-prompt error:", lastError);
      }
    }

    // Fallback: /generate-part (template library)
    if (!stl) {
      const form = new URLSearchParams();
      form.set("description", prompt);
      const r = await fetch(`${BACKEND}/generate-part`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: "Backend failed", detail: t || lastError }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      stl = await r.arrayBuffer();
      source = "template";
    }

    return new Response(stl, {
      headers: { ...corsHeaders, "Content-Type": "application/octet-stream", "x-source": source },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
