import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { feaData, software, analysisTypes } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an advanced FEA (Finite Element Analysis) interpretation engine inside the Dynaxor platform.

Your role is to analyze FEA simulation results and provide professional engineering interpretation.

You are an expert in:
• Structural mechanics & stress analysis
• Thermal simulation
• Fatigue & life prediction
• Modal/vibration analysis
• CFD interpretation
• Coupled multi-physics analysis

The user used: ${software}
Analysis types: ${analysisTypes.join(', ')}

RESPONSE FORMAT — You MUST respond in valid JSON with this exact structure:
{
  "riskLevel": "critical" | "high" | "medium" | "low",
  "riskScore": <number 0-100>,
  "overview": "<markdown text>",
  "materialPerformance": "<markdown text>",
  "stressAnalysis": "<markdown text>",
  "thermalAnalysis": "<markdown text>",
  "fatigueLifePrediction": "<markdown text>",
  "vibrationResonance": "<markdown text>",
  "deformationResults": "<markdown text>",
  "criticalErrors": "<markdown text>",
  "optimizationRecommendations": "<markdown text>",
  "nextSteps": "<markdown text>",
  "metrics": {
    "safetyFactor": "<string value>",
    "maxStressVsYield": "<string value>",
    "estimatedServiceLife": "<string value>",
    "criticalLocation": "<string value>",
    "failureRiskPercent": "<string value>"
  }
}

IMPORTANT:
• Analyze the data thoroughly and provide realistic engineering assessments
• If data is incomplete, note what's missing and work with what's available
• Always provide actionable recommendations
• Do NOT mention AI models or APIs
• Return ONLY the JSON object, no extra text`;

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
          { role: "user", content: `Analyze these FEA results:\n\n${feaData}` },
        ],
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

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";
    
    // Try to parse the JSON from the response
    let parsed;
    try {
      // Remove markdown code fences if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { error: "Failed to parse analysis", raw: content };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fea-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
