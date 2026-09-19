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

When you have gathered enough information (at least: function, size, environment, control, power, budget, user level), silently think through whether this device is physically possible to build in the real world — check for violations of physics (conservation of energy/momentum, thermodynamics), impossible material requirements, or self-contradictory requirements. Only flag something as not feasible for a genuine physical impossibility or contradiction — being expensive, difficult, or ambitious is NEVER a reason to flag it. Do not show this reasoning to the user.

Then present a requirements summary:

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
{"projectName":"...","description":"...","category":"...","purpose":"...","environment":"...","budget":"...","targetWeight":"...","targetSize":"...","powerSource":"...","controlMethod":"...","microcontroller":"...","has3dPrinter":false,"connectivity":"...","userLevel":"...","specialRequirements":"...","assumptions":[],"feasible":true,"feasibilityReason":"..."}

If you determined the device is NOT physically feasible, set "feasible":false and put a clear, friendly, 1-2 sentence explanation of exactly why in "feasibilityReason" — still fill in the rest of the JSON as best you can. If it IS feasible, set "feasible":true and leave "feasibilityReason" as an empty string.

IMPORTANT: Do NOT mention AI models, APIs, or providers. You are Lumexa's internal engineering system.`;

const buildGeneratePartsPrompt = (briefData: any) => `Based on this engineering brief: ${JSON.stringify(briefData)}

You are generating a COMPLETE build plan. User is from ${briefData.country || 'unknown country'} with ${briefData.experienceLevel || briefData.userLevel || 'beginner'} experience.

HARD REQUIREMENT — READ THIS FIRST: your "parts" array MUST contain AT LEAST 25 entries, and 30+ is the normal expectation for anything beyond a single-component gadget. This is a strict minimum, not a target to round down from. A real physical device is never built from 2-5 parts — even something simple has a body, a lid, internal mounts, standoffs, fasteners groups, cable clips, a battery tray, buttons/switches, a bezel, feet/grips, and more, each as its own entry. If your first pass has fewer than 25, you have under-decomposed the design — go back through every subsystem below and split it into its individual manufacturable pieces before you finalize. Never summarize a subsystem as one or two line items.

SELF-CHECK BEFORE YOU RESPOND: count the objects in your "parts" array. If the count is below 25, do not output yet — keep breaking sub-assemblies into individual brackets, arms, plates, fillets, gussets, spacers, standoffs, panels, mounts, and fastener groups until you reach at least 25, then output the final JSON.

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

PART GRANULARITY — Break every subsystem down into the smallest individual manufacturable parts, the way a real CAD assembly tree would list them. NEVER bundle multiple distinct parts into one entry — split a "mounting assembly" into its actual pieces: e.g. "Motor mount bracket (left)", "Motor mount bracket (right)", "Corner gusset/fillet", "Shaft spacer", "Standoff M3x10". Every bracket, arm, plate, fillet, gusset, spacer, and standoff gets its own entry with its own material, dimensions, and cost. Re-read the HARD REQUIREMENT above — this is where most attempts fail by stopping too early.

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
    {"componentName":"...","modelRecommendation":"...","whereToBuy":"...","price":0,"quantity":1,"purpose":"...","subsystem":"...","dimensions":"package type + physical size, e.g. 'SOIC-8, 4.9x3.9x1.75mm'"}
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

// Tries each configured Groq key in order — GROQ_API_KEY, then GROQ_API_KEY_2 through
// GROQ_API_KEY_5 if present — falling through to the next one only when a key is
// rate-limited (429) or out of quota (402). Returns the first successful response, or
// the last failed response once every configured key has been exhausted. A genuine
// request error (e.g. 400 bad request) is returned immediately without burning through
// the other keys, since switching keys wouldn't fix a malformed request.
async function fetchGroqWithFallback(body: Record<string, unknown>): Promise<Response> {
  const keys: string[] = [];
  const primary = Deno.env.get("GROQ_API_KEY");
  if (primary) keys.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GROQ_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  if (!keys.length) throw new Error("GROQ_API_KEY is not configured");

  let lastResponse: Response | null = null;
  for (let i = 0; i < keys.length; i++) {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keys[i]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) return resp;
    if (resp.status === 429 || resp.status === 402) {
      lastResponse = resp;
      console.error(`Groq key #${i + 1} exhausted (status ${resp.status}) — trying next key if available.`);
      continue;
    }
    return resp;
  }
  return lastResponse as Response;
}

const buildRefinePartsPrompt = (parts: any[], electronics: any[], briefData: any) => `You previously designed the mechanical parts for this project: ${briefData.projectName || briefData.description || 'a hardware project'}.

Here is the FINAL, VERIFIED list of electronic components that will actually be used — their physical package dimensions have been confirmed from real datasheets/product listings, which is more accurate than anything assumed earlier:
${JSON.stringify(electronics)}

Here is the current mechanical parts list:
${JSON.stringify(parts)}

TASK — fuse the real, verified component data into the mechanical design:
1. FIT: for every part whose job is to hold, mount, enclose, or route wiring for one or more of these components (brackets, mounts, enclosures, chassis compartments, standoffs, cable channels, connector cutouts, etc.), check its "dimensions" field against the REAL component footprint above and correct it if needed — add sensible clearance (typically +2-4mm per side inside an enclosure, matched hole spacing for a mounting bracket, a channel width based on the actual wire diameter for a wire run).
2. LOAD: if a real component's actual weight, current draw, or torque differs meaningfully from what was assumed when the part was first designed, correct anything that depends on it — thicker/reinforced material or wall thickness for a heavier real battery or motor, a wire gauge upgrade if the real current draw is higher than assumed, added standoffs/ribbing if a real component turned out heavier than the mount was designed for.
3. If a part's dimensions and material already comfortably fit and support the real components, leave it exactly as it was — do not change things that don't need changing.
4. Do NOT add or remove parts, and do NOT rename any part. Keep every field (partName, purpose, subsystem, material, estimatedCostUSD, manufacturingMethod, complexity, image_prompt, design_guide_context) exactly as given unless a correction from steps 1-2 genuinely requires updating it.

Return ONLY the corrected parts array as valid JSON — the same shape as the input array, no markdown fences, no commentary, no wrapper object.`;

// Uses Groq's compound model (built-in web search) to replace best-guess electronics
// pricing, sourcing, AND physical package dimensions with real, verified data pulled
// from actual datasheets/product pages — boosted to the user's country.
// Gracefully no-ops (returns the original list) if GROQ_API_KEY isn't set or anything fails,
// so this is safe to wire in before the key exists.
async function enrichElectronicsData(electronics: any[], country?: string) {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY || !Array.isArray(electronics) || !electronics.length) return electronics;

  try {
    const search_settings: Record<string, string> = {};
    if (country) search_settings.country = String(country).toLowerCase();

    const groqResp = await fetchGroqWithFallback({
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
    });

    if (!groqResp.ok) {
      console.error("Groq pricing enrichment failed:", groqResp.status, await groqResp.text());
      return electronics;
    }

    const groqResult = await groqResp.json();
    const raw = groqResult.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const enriched = JSON.parse(cleaned);
    return Array.isArray(enriched) && enriched.length ? enriched : electronics;
  } catch (e) {
    console.error("Groq pricing enrichment error:", e);
    return electronics;
  }
}

// Extracts JSON from a model response defensively — falls back to pulling out the
// largest {...} or [...] block in case the model added any preamble/trailing text.
function extractJson(content: string): any {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through to block extraction */ }
  const objMatch = content.match(/\{[\s\S]*\}/);
  const arrMatch = content.match(/\[[\s\S]*\]/);
  // Prefer whichever match is longer, since a stray {} inside an array (or vice versa)
  // could otherwise win by appearing first.
  const candidate = [objMatch?.[0], arrMatch?.[0]].filter(Boolean).sort((a, b) => (b as string).length - (a as string).length)[0];
  if (candidate) {
    try { return JSON.parse(candidate); } catch { /* give up below */ }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, briefData, parts, electronics } = await req.json();
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

    let systemPrompt = "";
    const model = "openai/gpt-oss-120b";
    let userMessages = messages;

    if (mode === "interview") {
      systemPrompt = MASTER_INTERVIEW_PROMPT;
    } else if (mode === "generate_parts") {
      systemPrompt = buildGeneratePartsPrompt(briefData);
    } else if (mode === "refine_parts") {
      systemPrompt = "You are Lumexa's internal engineering system. Follow the user's instructions exactly and return only the JSON they ask for.";
      userMessages = [{ role: "user", content: buildRefinePartsPrompt(parts, electronics, briefData || {}) }];
    }

    const response = await fetchGroqWithFallback({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ],
        stream: mode === "interview",
        max_tokens: mode === "generate_parts" ? 32000 : mode === "refine_parts" ? 16000 : undefined,
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
      const parsed = extractJson(content);

      if (parsed === null) {
        console.error(`design-generator: failed to parse ${mode} response. finish_reason:`, result.choices?.[0]?.finish_reason, "raw content:", content);
        return new Response(JSON.stringify({ error: mode === "refine_parts" ? "Failed to parse part refinement" : "Failed to parse brief", raw: content }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (mode === "generate_parts" && !parsed.error && Array.isArray(parsed.electronics) && parsed.electronics.length) {
        parsed.electronics = await enrichElectronicsData(parsed.electronics, briefData?.country);
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
