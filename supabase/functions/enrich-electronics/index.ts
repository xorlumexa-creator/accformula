import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Uses Groq's compound model (built-in web search) to replace best-guess electronics
// pricing, sourcing, AND physical package dimensions with real, verified data pulled
// from actual datasheets/product pages — boosted to the user's country.
// This is the ONLY piece of the design-generation pipeline that still needs to run
// server-side, since it needs the GROQ_API_KEY secret. The interview and parts
// generation itself now happen client-side via Puter.js (see src/lib/puterAI.ts).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { electronics, country } = await req.json();
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

    if (!GROQ_API_KEY || !Array.isArray(electronics) || !electronics.length) {
      return new Response(JSON.stringify({ electronics: electronics || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const search_settings: Record<string, string> = {};
    if (country) search_settings.country = String(country).toLowerCase();

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/compound",
        messages: [
          {
            role: "system",
            content: country
              ? `You are a component sourcing, pricing, and dimensioning specialist working for someone located in ${country}. You will receive a JSON array of electronic components for a hardware project.

SOURCING PRIORITY — this is the most important rule: for EACH component, search specifically for sellers, distributors, or marketplaces based IN ${country} first — local electronics shops, local online marketplaces, or distributors with a physical presence or local shipping in ${country}. Only if you have genuinely searched and cannot find any seller based in ${country} for a specific item, fall back to a well-known international supplier (Digi-Key, Mouser, AliExpress, Amazon, etc.) — and when you do, append " (imported — not locally available)" to that item's whereToBuy value so it's clearly flagged as not a local option. Do not default to international/US suppliers just because they're easier to find — actually check for ${country}-based options first for every single item.

For each component also confirm from its actual datasheet or product listing page: its exact model/part number, a realistic current price in the seller's actual currency, and its true physical package dimensions. For "dimensions", give the package type plus physical size in millimeters exactly as the datasheet states it (e.g. "SOIC-8, 4.9x3.9x1.75mm", "TO-220, 10.0x4.8x8.9mm", "Arduino Nano module, 45x18x7mm") — do not guess or reuse a generic estimate if the datasheet gives an exact figure. Keep the exact same array structure and field names as the input (componentName, modelRecommendation, whereToBuy, price, quantity, purpose, subsystem, dimensions). If you genuinely cannot find real data for an item after searching, keep its original values. Return ONLY the raw JSON array — no markdown fences, no commentary.`
              : `You are a component sourcing, pricing, and dimensioning specialist. You will receive a JSON array of electronic components for a hardware project. For EACH component, use web search to find a real, currently available product and confirm from its actual datasheet or product listing page: its exact model/part number, a realistic current price, a real place to buy it, and its true physical package dimensions. For "dimensions", give the package type plus physical size in millimeters exactly as the datasheet states it (e.g. "SOIC-8, 4.9x3.9x1.75mm", "TO-220, 10.0x4.8x8.9mm", "Arduino Nano module, 45x18x7mm") — do not guess or reuse a generic estimate if the datasheet gives an exact figure. Keep the exact same array structure and field names as the input (componentName, modelRecommendation, whereToBuy, price, quantity, purpose, subsystem, dimensions). If you genuinely cannot find real data for an item after searching, keep its original values. Return ONLY the raw JSON array — no markdown fences, no commentary.`,
          },
          { role: "user", content: JSON.stringify(electronics) },
        ],
        ...(Object.keys(search_settings).length ? { search_settings } : {}),
        compound_custom: {
          tools: { enabled_tools: ["web_search", "visit_website"] },
        },
      }),
    });

    if (!groqResp.ok) {
      console.error("Groq pricing enrichment failed:", groqResp.status, await groqResp.text());
      return new Response(JSON.stringify({ electronics }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqResult = await groqResp.json();
    const raw = groqResult.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let enriched = electronics;
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length) enriched = parsed;
    } catch (e) {
      console.error("Groq pricing enrichment parse error:", e);
    }

    return new Response(JSON.stringify({ electronics: enriched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("enrich-electronics error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
              
