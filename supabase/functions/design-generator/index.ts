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
- Maximum 15 questions total
- Never repeat what user already said, and never ask about something they already answered — even indirectly, elsewhere in the conversation

BE A REAL INTERVIEWER, NOT A FORM: every question you ask must be generated fresh from what the user just told you — never recite a stock question verbatim, and never work through a fixed checklist in a fixed order regardless of what they say. Before each question, briefly react to their last answer (a short, genuine acknowledgment — not a full paragraph) so the exchange feels like a conversation, not a survey. If an answer raises something specific and interesting — a constraint, a material preference, a use-case detail, a worry they mention — follow up on THAT specific thing next, even if it means covering topics out of the usual order, or asking something not listed below at all. If an answer already covers two things at once (e.g. they describe both size AND where they'll use it, unprompted), don't force a separate question for something they already told you — move straight to what's actually still missing. Two different users describing "a drone" should not get an identical sequence of questions if they've said different things — their answers should visibly shape what you ask next.

TOPICS TO COVER (use good judgment on order and phrasing — this is WHAT to find out, never a script for HOW to ask it):
- Function: the one main job of the device
- Size: use a comparison, phrased to fit what they've already described, not recited verbatim
- Environment: where it's mainly used
- Control: how the user interacts with it
- Power: source, and roughly how long it needs to run
- Budget: a rough tier is enough
- Materials: any lightweight/strength/durability requirement
- Existing tools/parts: anything already on hand, e.g. a 3D printer
- User's experience level: have they built something like this before
- Connectivity: any wireless requirement
- Anything special: hard must-haves, or hard no's

DIMENSION TRANSLATION — Never ask "what are the dimensions?" Use comparisons as your starting technique, but adapt the wording to the conversation rather than reciting these verbatim every time:
SIZE: "Would it fit in your palm, or more like a shoebox, or bigger than that?"
WEIGHT: "Should it feel like a phone, a water bottle, or a backpack?"
POWER: "Like a phone battery, laptop battery, or needs to be plugged in?"
STRENGTH: "Hold a phone, hold a person, or survive being dropped?"

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

// STAGE 1 of 2 for the mechanical build-out: produces only the MACRO assemblies (e.g. for a
// drone: "Frame", "Arms", "Landing Gear") plus the full electronics list — never individual
// manufacturable parts. Individual parts are generated later, one macro assembly at a time,
// only once the user actually opens that assembly on the Parts page (see
// buildGenerateMicroPartsPrompt / mode "generate_micro_parts" below). Splitting generation
// this way keeps every single LLM call small and focused instead of asking GLM to produce an
// entire 25-40 part list (with full material/dimension/cost reasoning for every one of them)
// in one shot — the previous single-shot approach was the "LLM gets exhausted" failure mode.
const buildGenerateMacroPartsPrompt = (briefData: any) => `Based on this engineering brief: ${JSON.stringify(briefData)}

You are producing the FIRST-PASS structural breakdown of a build plan: the MACRO assemblies only — not individual manufacturable parts yet. User is from ${briefData.country || 'unknown country'} with ${briefData.experienceLevel || briefData.userLevel || 'beginner'} experience.

WHAT A "MACRO PART" IS: a genuinely distinct physical/structural/mechanical sub-assembly of the device — the kind of grouping a real engineer would treat as its own sub-assembly or its own CAD sub-folder. Examples for a quadcopter drone: "Frame / Central Body", "Arms", "Landing Gear", "Motor Mounts", "Battery Bay", "Camera/Gimbal Mount", "Power Distribution Housing", "Wiring & Cable Management". Examples for a handheld electronic gadget: "Main Enclosure", "Battery Compartment", "Button/Switch Panel", "Display Bezel", "Internal PCB Mounts".

RULES for macro parts:
- MECHANICAL/STRUCTURAL ONLY. A macro part is something that gets CAD-modeled and manufactured (3D printed, machined, laser cut, etc.) — never an electronic component or subsystem by itself. "Flight Controller" is not a macro part; "Flight Controller Mount" is.
- Typically 5 to 12 macro assemblies for a moderately complex device — fewer for something simple (a single bracket-only gadget might need just 2-3), more for something complex. Don't force a count; decompose based on what the device actually needs.
- Each macro assembly must be distinct — don't split one physical grouping into two entries, and don't lump structurally unrelated things into one entry just to hit a number.
- Every macro assembly listed here WILL later be expanded into its own individual manufacturable parts (brackets, plates, standoffs, etc.) — so don't pre-decompose here; just name and describe the assembly as a whole, one level up from individual parts.

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
  "macroParts": [
    {"name":"...","purpose":"one sentence describing this assembly's structural/functional role","subsystem":"..."}
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
Include EVERY electronic component needed for the project overall — this is the full component list for the whole device, not scoped to any single macro assembly. Be specific with real product names and prices in user's local currency. Return ONLY valid JSON.`;

// STAGE 2 of 2: given ONE macro assembly (plus the full brief and the already-real,
// datasheet-verified electronics list from stage 1), decomposes just that assembly into its
// individual manufacturable CAD parts. Called on demand from the Parts page the first time
// the user opens a given macro assembly — never for the whole project at once.
const buildGenerateMicroPartsPrompt = (macroPart: any, briefData: any, electronics: any[]) => `Project: ${briefData.projectName || briefData.description || 'a hardware project'}. Full brief: ${JSON.stringify(briefData)}

You are now decomposing ONE macro assembly — NOT the whole device — into its individual manufacturable CAD parts.

MACRO ASSEMBLY TO DECOMPOSE: "${macroPart.name}"
Its role: ${macroPart.purpose || 'not specified'}
Subsystem: ${macroPart.subsystem || 'general structure'}

Here is the FULL, VERIFIED electronics list for the entire project (real, datasheet-confirmed dimensions/weights where available) — use it to reason about which components physically live in, on, or near THIS assembly, and size/shape this assembly's parts to actually hold, mount, clear, or route wiring for them:
${JSON.stringify(electronics)}

TASK: list every individual manufacturable part that makes up "${macroPart.name}" — the way a real CAD assembly tree would list the files under that sub-assembly. Only parts belonging to THIS macro assembly — do not describe other assemblies.

PART SIZE CEILING: every entry must be sized like ONE manufacturable component, not a whole sub-assembly standing in for several parts. Concrete gut-check before you write each "purpose" string: if it needs the word "and" more than once to describe what the part does (e.g. "holds the motor AND routes the wiring AND supports the axle"), split it into the separate pieces a real machinist or 3D-print operator would actually produce as separate files/setups. Typical real sizes for reference: a bracket, standoff, gusset, clip, or small lid is usually 20-150mm on its largest side; a mounting plate or short structural rail might reach 150-250mm; only a genuine single-piece base or long rail that cannot be functionally split without losing strength should ever exceed that.

COUNT: however many genuinely distinct manufacturable parts this ONE assembly actually needs — typically 2 to 10 depending on complexity. Don't pad with redundant entries, and don't collapse several real parts into one oversized entry either.

DIMENSIONING — reason like a mechanical engineer, not a guesser:
- If a part mounts, encloses, or routes wiring for one or more of the electronics above, size it around their REAL confirmed dimensions with sensible clearance (typically +2-4mm per side inside an enclosure, matched hole spacing for a mounting bracket, a channel sized to the actual wire gauge for a wire run).
- Consider the LOAD this part actually carries (a motor's thrust and vibration, a battery's real weight, a structural member's span, expected drop/impact for a handheld device) and size wall thickness / cross-section accordingly — don't just guess a generic wall thickness.
- Give your best real-world-grounded initial estimate; it will be cross-checked against real comparable products in a separate web-search pass next, so reasoning quality here matters more than perfect precision.

Return ONLY valid JSON:
{
  "parts": [
    {
      "partName":"...","purpose":"...","material":"...","dimensions":"...","estimatedCostUSD":0,"manufacturingMethod":"...","complexity":"Beginner|Intermediate|Advanced",
      "image_prompt": "Photorealistic 3D CAD render of [PART] — part of [PROJECT]: [dimensions], [material], isometric 3/4 zoomed, Background: #E8E8E8, top-left lighting, 4-6 leader line annotations",
      "design_guide_context": "Key engineering context for generating step-by-step guide"
    }
  ]
}

Return ONLY valid JSON, no markdown fences, no commentary, no wrapper text.`;

// MODEL SWITCH: interview/generate_macro_parts/generate_micro_parts/refine_parts all run on
// NVIDIA's hosted z-ai/glm-5.3 (confirmed live on build.nvidia.com's free-endpoint catalog,
// OpenAI-compatible /v1/chat/completions). Mirrors fetchGroqWithFallback's exact key-rotation
// shape — NVIDIA_API_KEY, then _2 through _5 if present — since NVIDIA's free tier for this
// model is rate-limited (documented ~40 requests/minute), and a single key would throttle a
// live app fast. A genuine request error (e.g. 400) still returns immediately without burning
// through other keys, since switching keys wouldn't fix a malformed request.
async function fetchNvidiaWithFallback(body: Record<string, unknown>): Promise<Response> {
  const keys: string[] = [];
  const primary = Deno.env.get("NVIDIA_API_KEY");
  if (primary) keys.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`NVIDIA_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  if (!keys.length) throw new Error("NVIDIA_API_KEY is not configured");

  let lastResponse: Response | null = null;
  for (let i = 0; i < keys.length; i++) {
    const resp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
      console.error(`NVIDIA key #${i + 1} exhausted (status ${resp.status}) — trying next key if available.`);
      continue;
    }
    return resp;
  }
  return lastResponse as Response;
}

// Tries each configured Groq key in order — GROQ_API_KEY, then GROQ_API_KEY_2 through
// GROQ_API_KEY_5 if present — falling through to the next one only when a key is
// rate-limited (429) or out of quota (402). Returns the first successful response, or
// the last failed response once every configured key has been exhausted. A genuine
// request error (e.g. 400 bad request) is returned immediately without burning through
// the other keys, since switching keys wouldn't fix a malformed request.
// USED for enrichElectronicsData and enrichPartDimensions — both rely specifically on Groq's
// "compound" model, which has built-in live web search baked into the model itself. GLM-5.3
// on NVIDIA is a plain chat model with no equivalent built-in browsing tool, so switching
// these calls to NVIDIA would silently lose the live datasheet/reference-design lookups they
// exist for. This function stays scoped to that one purpose, not the general "which LLM" choice.
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

// Kept for backward compatibility / a possible future "refresh dimensions" action, but no
// longer called by the default flow: generate_micro_parts already reasons about electronics
// fit inline (it receives the same verified electronics list from the start), and
// enrichPartDimensions (below) now does the real-world grounding pass that this used to do
// via a second GLM call — via actual web search instead, which this function's GLM-only pass
// never had.
const buildRefinePartsPrompt = (parts: any[], electronics: any[], briefData: any) => `You previously designed the mechanical parts for this project: ${briefData.projectName || briefData.description || 'a hardware project'}.

Here is the FINAL, VERIFIED list of electronic components that will actually be used — their physical package dimensions have been confirmed from real datasheets/product listings, which is more accurate than anything assumed earlier:
${JSON.stringify(electronics)}

Here is the current mechanical parts list:
${JSON.stringify(parts)}

TASK — fuse the real, verified component data into the mechanical design:
1. FIT: for every part whose job is to hold, mount, enclose, or route wiring for one or more of these components (brackets, mounts, enclosures, chassis compartments, standoffs, cable channels, connector cutouts, etc.), check its "dimensions" field against the REAL component footprint above and correct it if needed — add sensible clearance (typically +2-4mm per side inside an enclosure, matched hole spacing for a mounting bracket, a channel width based on the actual wire diameter for a wire run).
2. LOAD: if a real component's actual weight, current draw, or torque differs meaningfully from what was assumed when the part was first designed, correct anything that depends on it — thicker/reinforced material or wall thickness for a heavier real battery or motor, a wire gauge upgrade if the real current draw is higher than assumed, added standoffs/ribbing if a real component turned out heavier than the mount was designed for.
3. If a part's dimensions and material already comfortably fit and support the real components, leave it exactly as it was — do not change things that don't need changing.
4. Do NOT add or remove parts, and do NOT rename any part. Keep every field (partName, purpose, subsystem, material, dimensions, estimatedCostUSD, manufacturingMethod, complexity, image_prompt, design_guide_context) exactly as given unless a correction from steps 1-2 genuinely requires updating it.
5. "dimensions" must NEVER be empty or omitted in your output — every part you return must have a non-empty "dimensions" value, copied unchanged from the input if step 1 found no correction needed for that part.

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
// Doubles as the safety net for GLM-5.3's hybrid thinking mode: if any reasoning
// text ends up mixed into content instead of arriving in a separate field, this
// still finds the actual JSON object/array inside it rather than failing outright.
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

// FIX: added alongside the prompt fix above as a second, independent line of
// defense — confirmed live that the model can silently drop a field despite
// being told to keep it, so this guarantees the field survives even if that
// happens again for "dimensions" or any other field in the future. Merges
// each refined part back onto its original counterpart (by array position,
// which buildRefinePartsPrompt's own "do NOT add or remove parts" instruction
// guarantees stays aligned) instead of trusting the refined array wholesale —
// any field the model returns empty/missing falls back to the original value
// rather than overwriting good data with a blank.
function mergeRefinedParts(original: any[], refined: any[]): any[] {
  if (!Array.isArray(refined) || refined.length !== original.length) return original;
  return original.map((orig, i) => {
    const r = refined[i] || {};
    const merged: any = { ...orig };
    for (const key of Object.keys(orig)) {
      const v = r[key];
      if (v !== undefined && v !== null && v !== "") merged[key] = v;
    }
    return merged;
  });
}

// The web-search grounding pass for micro-part dimensions: takes GLM's initial reasoning
// (already fit/load-aware, from buildGenerateMicroPartsPrompt) and cross-checks it against
// real comparable products/reference designs via Groq compound's live search — the same
// two-stage "LLM reasons, then web search grounds it" pattern enrichElectronicsData already
// uses for components, now applied to the mechanical parts that hold/mount/route wiring for
// them. Gracefully returns the parts unchanged if GROQ_API_KEY isn't set or anything fails.
async function enrichPartDimensions(parts: any[], electronics: any[], macroPart: any, briefData: any, country?: string) {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY || !Array.isArray(parts) || !parts.length) return parts;

  try {
    const search_settings: Record<string, string> = {};
    if (country) search_settings.country = String(country).toLowerCase();

    const groqResp = await fetchGroqWithFallback({
      model: "groq/compound",
      messages: [
        {
          role: "system",
          content: `You are a mechanical dimensioning specialist with live web search. You will receive a JSON object describing ONE mechanical sub-assembly of a hardware project ("${macroPart?.name || 'assembly'}", part of "${briefData?.projectName || 'a hardware project'}"), the individual parts within it, and the real electronic components it must fit/mount/route wiring for.

For EACH part, use web search to find comparable REAL reference designs or products (e.g. a similar-class drone's arm dimensions, a similar enclosure's wall thickness, a similar bracket's standard hole spacing) and correct its "dimensions" field to be realistic and properly justified — grounded in: (a) the REAL physical size/weight of the electronics it must hold/enclose/route wiring for (given below, with sensible clearance added), and (b) the mechanical load it carries (motor thrust/vibration, battery weight, span under structural load, expected drop/impact for a handheld device, etc.). Also sanity-check "material" and "manufacturingMethod" against what real comparable parts actually use, and adjust "estimatedCostUSD" if the corrected dimensions/material meaningfully change it.

Do NOT add, remove, or rename parts. Keep every field (partName, purpose, material, dimensions, estimatedCostUSD, manufacturingMethod, complexity, image_prompt, design_guide_context) present in your output exactly as given unless your research genuinely requires correcting it. "dimensions" must NEVER be empty — if you find no correction needed, copy the input value unchanged. Return ONLY the corrected parts array as valid JSON, in the same order, same shape as the input "parts" array — no markdown fences, no commentary, no wrapper object.`,
        },
        {
          role: "user",
          content: JSON.stringify({ macroAssembly: { name: macroPart?.name, purpose: macroPart?.purpose }, parts, relevantElectronics: electronics }),
        },
      ],
      ...(Object.keys(search_settings).length ? { search_settings } : {}),
      compound_custom: {
        tools: { enabled_tools: ["web_search", "visit_website"] },
      },
    });

    if (!groqResp.ok) {
      console.error("Groq part-dimension enrichment failed:", groqResp.status, await groqResp.text());
      return parts;
    }

    const groqResult = await groqResp.json();
    const raw = groqResult.choices?.[0]?.message?.content || "";
    const enriched = extractJson(raw);
    return Array.isArray(enriched) ? mergeRefinedParts(parts, enriched) : parts;
  } catch (e) {
    console.error("Groq part-dimension enrichment error:", e);
    return parts;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, briefData, parts, electronics, macroPart } = await req.json();
    // NVIDIA is now the required key for the core function — GROQ_API_KEY is
    // only needed for the two web-search enrichment steps and is checked
    // independently inside those functions (missing it just skips enrichment).
    const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
    if (!NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not configured");

    let systemPrompt = "";
    const model = "z-ai/glm-5.3";
    let userMessages = messages;

    if (mode === "interview") {
      systemPrompt = MASTER_INTERVIEW_PROMPT;
    } else if (mode === "generate_macro_parts") {
      systemPrompt = buildGenerateMacroPartsPrompt(briefData);
    } else if (mode === "generate_micro_parts") {
      systemPrompt = "You are Lumexa's internal engineering system. Follow the user's instructions exactly and return only the JSON they ask for.";
      userMessages = [{ role: "user", content: buildGenerateMicroPartsPrompt(macroPart || {}, briefData || {}, electronics || []) }];
    } else if (mode === "refine_parts") {
      systemPrompt = "You are Lumexa's internal engineering system. Follow the user's instructions exactly and return only the JSON they ask for.";
      userMessages = [{ role: "user", content: buildRefinePartsPrompt(parts, electronics, briefData || {}) }];
    }

    const response = await fetchNvidiaWithFallback({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ],
        stream: mode === "interview",
        max_tokens: mode === "generate_macro_parts" ? 16000
          : mode === "generate_micro_parts" ? 8000
          : mode === "refine_parts" ? 16000
          : undefined,
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
        const label = mode === "refine_parts" || mode === "generate_micro_parts" ? "Failed to parse parts" : "Failed to parse brief";
        return new Response(JSON.stringify({ error: label, raw: content }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (mode === "generate_macro_parts" && !parsed.error && Array.isArray(parsed.electronics) && parsed.electronics.length) {
        parsed.electronics = await enrichElectronicsData(parsed.electronics, briefData?.country);
      }

      if (mode === "generate_micro_parts") {
        const rawParts = Array.isArray(parsed?.parts) ? parsed.parts : Array.isArray(parsed) ? parsed : [];
        const grounded = await enrichPartDimensions(rawParts, electronics || [], macroPart || {}, briefData || {}, briefData?.country);
        return new Response(JSON.stringify({ parts: grounded }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // FIX: merge instead of trust-wholesale — see mergeRefinedParts above.
      if (mode === "refine_parts" && Array.isArray(parsed)) {
        return new Response(JSON.stringify(mergeRefinedParts(parts, parsed)), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
