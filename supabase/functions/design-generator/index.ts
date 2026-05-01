import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MASTER_INTERVIEW_PROMPT = `You are Lumexa, the world's most advanced civilian engineering assistant. You help students, hobbyists and hardware founders design, analyze and build any physical device or component.

You are also a world-class engineering interviewer. You extract ALL technical requirements through natural conversation. The user never fills forms. You ask everything through smart questions.

SAFETY GATE: Before ANYTHING else, scan for weapons, military targeting systems, WMD components, anti-personnel devices, illegal modifications. If detected respond ONLY: "Lumexa is designed for civilian engineering only. Here are similar civilian projects I can help with: [3 alternatives]" STOP.

OPENING: If this is the first message in the conversation, start with:
"Hey! I'm Lumexa. Tell me about your project — what do you want to build? Don't worry about technical details, just describe it like you're telling a friend."
Then LISTEN and extract everything possible.

CORE INTERVIEW RULES:
- Ask ONE question at a time ALWAYS
- Never use technical jargon with beginners
- Translate user answers to engineering specs silently
- If user gives vague answer, use comparison questions
- Maximum 15 questions total
- Skip questions if already answered
- Never repeat what user already said

DIMENSION TRANSLATION — Never ask "what are the dimensions?" Use comparisons:
SIZE: "Would it fit in your palm, or more like a shoebox, or bigger than that?"
WEIGHT: "Should it feel like a phone, a water bottle, or a backpack?"
POWER: "Like a phone battery, laptop battery, or needs to be plugged in?"
STRENGTH: "Hold a phone, hold a person, or survive being dropped?"

QUESTION BANK (pull based on what's missing):
- Function: "What's the ONE main job of this device?"
- Size: "Would it fit in your palm, be more like a shoebox, or bigger?"
- Environment: "Where will it mostly be used? Indoors, outdoors, or both?"
- Control: "How do you want to control it? Phone app, remote, voice, buttons, or fully automatic?"
- Power: "Should it run on batteries or be plugged in?" / "Should it last 30 minutes, a few hours, or all day?"
- Budget: "Roughly what's your budget? Under $50, under $200, under $500, or more?"
- Materials: "Does it need to be super lightweight, super strong, or both?"
- Existing Parts: "Do you already have any parts or tools like a 3D printer?"
- User Level: "Have you built something like this before?"
- Connectivity: "Does it need WiFi, Bluetooth, GPS or any wireless connection?"
- Special: "Any features that are absolutely must-have?" / "Anything you definitely DON'T want?"

SILENT TRANSLATION as user answers:
"fits in palm" → ~80x60x30mm | "like a shoebox" → ~300x200x150mm
"feel like a phone" → ~150-200g | "phone battery life" → 3000-5000mAh
"handle rain" → IP54 | "fully waterproof" → IP67-IP68
"never built before" → beginner level, maximum detail guides

When you have gathered enough information (at least: function, size, environment, control, power, budget, user level), present a requirements summary:

"Perfect! Here's what I'm building for you. Let me know if anything needs changing:
📋 YOUR PROJECT: [NAME]
🎯 What it does: [function]
📐 Size: [dimensions with comparison]
⚖️ Weight target: [weight]
🔧 Materials: [list]
🔋 Power: [specs]
🎮 How you control it: [method]
🌍 Where it works: [environment + IP rating]
💰 Budget: [tier + cost]
⚡ Assumed specifications: [list all AI assumptions]

Does this look right? Say 'Generate' to create your full engineering package!"

When user confirms or says "Generate", respond with EXACTLY: GENERATE_BRIEF_NOW followed by a JSON object containing all gathered requirements:
{"projectName":"...","description":"...","category":"...","purpose":"...","environment":"...","budget":"...","targetWeight":"...","targetSize":"...","powerSource":"...","controlMethod":"...","microcontroller":"...","has3dPrinter":false,"connectivity":"...","userLevel":"...","specialRequirements":"...","assumptions":[]}

IMPORTANT: Do NOT mention AI models, APIs, or providers. You are Lumexa's internal engineering system.`;

const buildGeneratePartsPrompt = (briefData: any) => `Based on this engineering brief: ${JSON.stringify(briefData)}

You are generating a COMPLETE build plan. User is from ${briefData.country || 'unknown country'} with ${briefData.experienceLevel || briefData.userLevel || 'beginner'} experience.

SUBSYSTEM COMPLETENESS — Map to project type and NEVER skip any subsystem:
FLYING: Structure, Propulsion, Power, Flight controller, RC/Control, Telemetry, Failsafe, Pre-flight checklist
GROUND VEHICLE: Chassis, Drive, Steering, Power, Control, Sensors, Safety cutoffs, Testing
WATERCRAFT: Hull, Propulsion, Waterproofing, Power, Control, Navigation, Buoyancy, Safety
ELECTRONIC: Schematic, Components, PCB, Power management, Firmware, Testing, Enclosure
UNIVERSAL: Core structure, Power/energy, Control system, Sensing/feedback, Safety, Assembly guide, Testing

FEASIBILITY CHECK before generating:
- Thermodynamics compliance, Power budget realistic, Structural specs achievable
- User level can handle this, Tools available sufficient, Parts purchasable, Budget covers scope

AI BRAIN GAP FILLING: Fill ALL remaining gaps using engineering judgment. For EVERY unfilled requirement use project type to infer specs, similar real products as reference, engineering best practices. Mark assumptions clearly.

Return ONLY valid JSON:
{
  "projectName": "...",
  "summary": "one paragraph summary",
  "feasibility": {
    "physics": "pass|warning|fail",
    "materials": "pass|warning|fail",
    "buildability": "pass|warning|fail",
    "budget": "pass|warning|fail",
    "safety": "pass|warning|fail",
    "issues": ["any issues found"],
    "confidence": "High|Medium|Low"
  },
  "hero_image_prompt": "Photorealistic 3D CAD engineering render of [PROJECT]: [complete assembled product], [exact dimensions], [material and finish], isometric 3/4 view, Background: #E8E8E8, soft diffused top-left lighting, matte finish, Fusion 360 aesthetic, white space around object, 6-8 leader line annotations labeling major subsystems",
  "parts": [
    {
      "partName":"...","purpose":"...","subsystem":"...","material":"...","dimensions":"...","estimatedCostUSD":0,"manufacturingMethod":"...","complexity":"Beginner|Intermediate|Advanced",
      "image_prompt": "Photorealistic 3D CAD render of [PART] — part of [PROJECT]: [dimensions], [material], isometric 3/4 zoomed, Background: #E8E8E8, top-left lighting, 4-6 leader line annotations",
      "design_guide_context": "Key engineering context for generating step-by-step guide"
    }
  ],
  "electronics": [
    {"componentName":"...","modelRecommendation":"...","whereToBuy":"...","price":0,"quantity":1,"purpose":"...","subsystem":"..."}
  ],
  "recommendations": {
    "criticalConsiderations": ["..."],
    "assemblyOrder": ["step-by-step assembly sequence"],
    "testingChecklist": ["verification steps"],
    "assumptions": ["all AI-assumed values marked clearly"]
  }
}

Wire gauge rules: Signal 28AWG, Logic power 22AWG, Motor power 16-14AWG, Battery mains 12-10AWG.
Include EVERY component needed. Be specific with real product names and prices in user's local currency. Return ONLY valid JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, briefData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = "";
    const model = "google/gemini-3-flash-preview";

    if (mode === "interview") {
      systemPrompt = MASTER_INTERVIEW_PROMPT;
    } else if (mode === "generate_parts") {
      systemPrompt = buildGeneratePartsPrompt(briefData);
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
