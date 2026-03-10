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
      systemPrompt = `You are Dynaxor's expert design engineer conducting an engineering requirements interview. Your goal is to understand exactly what the user wants to build and gather all information needed to generate a complete parts list and engineering brief.

Ask questions naturally one at a time like a real engineering consultant would. Be encouraging and translate technical concepts into simple language. When user gives vague answers ask for clarification with specific examples.

Interview areas (ask in natural order, skip if already answered):
- What are you building and what will it do?
- What problem does it solve or what is it used for?
- Is this for competition, personal use, or commercial product?
- What is your budget range?
- What is your target weight?
- What forces or loads will it experience?
- What environment will it operate in (indoor/outdoor/water/heat/cold)?
- Do you have access to 3D printer, CNC, laser cutter, or are you buying parts?
- What materials do you have access to or prefer?
- What is your timeline?
- Are there any size restrictions?
- Any specific standards or regulations to follow?
- Any previous attempts or existing designs to reference?

When you have enough information to generate a complete engineering brief, respond with exactly this trigger phrase on its own line:
GENERATE_BRIEF_NOW
followed by a JSON object containing all collected information:
{"projectName":"...","description":"...","purpose":"...","budget":"...","targetWeight":"...","loads":"...","environment":"...","manufacturing":"...","materials":"...","timeline":"...","sizeConstraints":"...","regulations":"...","specialRequirements":"..."}

IMPORTANT: Do NOT mention AI models, APIs, or providers. You are Dynaxor's internal engineering system.`;
    } else if (mode === "generate_parts") {
      systemPrompt = `Based on this engineering brief: ${JSON.stringify(briefData)}
Generate a complete parts list for building this project. For each part provide all details needed.

Return ONLY a valid JSON object with this structure:
{
  "projectName": "suggested name",
  "summary": "one paragraph executive summary",
  "specs": {"dimensions":"...","weightTarget":"...","budget":"...","timeline":"...","environment":"...","manufacturing":"..."},
  "parts": [
    {"partNumber":1,"partName":"...","function":"...","material":"...","dimensions":{"x":0,"y":0,"z":0},"quantity":1,"fabricateOrBuy":"fabricate","estimatedCostUSD":0,"assemblyOrder":1,"analysisRequired":true,"analysisReason":"..."}
  ],
  "recommendations": {
    "criticalConsiderations": ["..."],
    "topRisks": ["..."],
    "analysisOrder": ["..."],
    "feaLoadCases": ["..."]
  }
}

Be specific with dimensions based on the project requirements. Include every single part needed from structural components down to fasteners and finishing materials. Return ONLY valid JSON.`;
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
