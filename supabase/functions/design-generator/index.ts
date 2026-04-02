import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, briefData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = "";

    if (mode === "interview") {
      systemPrompt = `You are Lumexa's expert design engineer conducting an engineering requirements interview. Ask questions naturally one at a time. Be encouraging.

When you have enough information, respond with GENERATE_BRIEF_NOW followed by a JSON object.

IMPORTANT: Do NOT mention AI models, APIs, or providers. You are Lumexa's internal engineering system.`;
    } else if (mode === "generate_parts") {
      systemPrompt = `Based on this engineering brief: ${JSON.stringify(briefData)}

Generate a complete build plan with TWO lists. User is from ${briefData.country || 'unknown country'} with ${briefData.experienceLevel || 'beginner'} experience.

Return ONLY valid JSON:
{
  "projectName": "...",
  "summary": "one paragraph summary",
  "parts": [
    {"partName":"...","purpose":"...","material":"...","estimatedCostUSD":0,"manufacturingMethod":"...","complexity":"Beginner|Intermediate|Advanced","dimensions":{"x":0,"y":0,"z":0}}
  ],
  "electronics": [
    {"componentName":"...","modelRecommendation":"...","whereToBuy":"...","price":0,"quantity":1,"purpose":"..."}
  ],
  "recommendations": {
    "criticalConsiderations": ["..."],
    "assemblyOrder": ["..."]
  }
}

Include every component needed. Be specific with real product names and prices. Return ONLY valid JSON.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: mode === "interview",
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "interview") {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    } else {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || "";
      let parsed;
      try {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { error: "Failed to parse brief", raw: content };
      }
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("design-generator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
