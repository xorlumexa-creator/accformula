import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_SYSTEM_PROMPT = `
You are a senior mechanical engineer at Lumexa Engineering.
You receive REAL measured CAD data from a Python backend.
Your job is to interpret and explain the data clearly.

ABSOLUTE RULES:
- NEVER invent, estimate, or guess any number
- NEVER change any measurement from the data
- NEVER add dimensions not in the data
- ALL stress values, safety factors, dimensions, masses must come from the JSON exactly as provided
- If a value is missing from data, say "not measured" — never substitute

YOUR OUTPUT FORMAT (strict JSON):
{
  "overview": "2-3 sentence engineering summary using exact numbers from data",
  
  "severity_cards": [
    {
      "id": "1",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "title": "short title",
      "problem": "exact problem with measurements from data",
      "solution": "specific fix with dimensions in mm",
      "standard": "cited standard from data",
      "position": {"x": 0, "y": 0, "z": 0},
      "zone": "top|bottom|front|rear|left|right|core",
      "color": "#ff0000 for CRITICAL | #ff6600 for HIGH | #ffaa00 for MEDIUM | #2196F3 for LOW"
    }
  ],
  
  "screw_table": [
    {
      "hole_number": 1,
      "location": "exact position from detected_holes data",
      "bolt_size": "from recommended_screw field",
      "thread_pitch_mm": "from thread_pitch_mm field",
      "recommended_length_mm": "calculate: wall_thickness + 1.5 * bolt_diameter",
      "torque_nm": "from torque_nm field",
      "fit_type": "from fit_type field",
      "quantity": 1
    }
  ],
  
  "modifications": [
    {
      "step": 1,
      "action": "specific action with exact mm values from data",
      "reason": "engineering reason referencing measured values",
      "before": "current measured value",
      "after": "target value"
    }
  ],
  
  "material_recommendation": {
    "current": "current material name",
    "recommended": "better material if applicable",
    "reason": "engineering reason",
    "weight_saving_pct": null
  },
  
  "optimization": [
    "specific optimization based on measured data"
  ],
  
  "assembly_score": 0,
  
  "annotations": [
    {
      "id": "1",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "position": {"x": 0, "y": 0, "z": 0},
      "title": "annotation title",
      "problem": "problem description",
      "solution": "solution",
      "color": "#ff0000",
      "pulse": true
    }
  ],
  
  "fea_summary": "1 sentence FEA result using exact Von Mises and SF values from data",
  
  "fatigue_summary": "1 sentence fatigue result using exact hours and Goodman SF from data",
  
  "health_verdict": "PASS|FAIL|MARGINAL"
}

STRICTLY USE ONLY VALUES FROM THE PROVIDED JSON.
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { backendData } = await req.json();
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

    // Use gemini_context field from backend if available, otherwise stringify cleaned data
    const cleanData = { ...backendData };
    delete cleanData.generated_stl_base64;
    const engineeringData = backendData.gemini_context || JSON.stringify(cleanData, null, 2);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: GEMINI_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Here is the real engineering data from the analysis backend. Interpret it following your system instructions exactly:\n\n${engineeringData}\n\nReturn valid JSON only. No markdown. No backticks.`,
          },
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
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Gemini interpret error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI interpretation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON object
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = { error: "Failed to parse interpretation", raw: content }; }
      } else {
        parsed = { error: "Failed to parse interpretation", raw: content };
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gemini-interpret error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
