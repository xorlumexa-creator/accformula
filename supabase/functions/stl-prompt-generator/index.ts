import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// This function deliberately uses a SEPARATE Groq API key (GROQ_API_KEY_2) from the
// rest of the app (GROQ_API_KEY, used by design-generator for the bulk parts/mechanism
// planning call). Reasons:
//
// 1. Rate limits: design-generator's generate_parts call already produces 15-40 parts
//    in one shot. If a project has many parts, the user can trigger many of THESE calls
//    in quick succession (one per part, from PartsPage). Sharing one Groq key between
//    "one big planning call" and "N per-part calls" means the N calls can burn through
//    the key's rate limit and start failing/degrading right when there are the most
//    parts to process — exactly when it matters most.
// 2. Quality isolation: this call's only job is to turn a part's (possibly thin/generic)
//    spec into a rich, geometrically distinct CAD prompt. Keeping it on its own key means
//    a rate-limit or quota issue on the planning key never blocks STL prompt generation,
//    and vice versa.
//
// Falls back to a locally-built prompt (mirroring the previous static template) if
// GROQ_API_KEY_2 isn't configured or the call fails, so STL generation never hard-fails
// just because this enrichment step is unavailable.

// Minimal built-in fallback, only used if the client didn't send its own
// fallbackPrompt (kept for safety/back-compat).
function fallbackPrompt(part: any, project: any): string {
  return `${part.partName} — one individual mechanical part for a ${project?.projectName || 'hardware'} project (${project?.projectDescription || 'no further project description'}).
Purpose: ${part.purpose || 'infer from name and subsystem'}. Subsystem: ${part.subsystem || 'general structure'}.
Dimensions: ${part.dimensions || 'infer reasonable dimensions for a part of this type and function'}.
Manufacturing method: ${part.manufacturingMethod || 'CNC machining or 3D printing, whichever suits this part'}.
Design complexity level: ${part.complexity || 'Beginner'}.
Generate a precise, manufacturable CAD model for this exact single part only — not an assembly, not other parts.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { part, project, fallbackPrompt: clientFallback } = await req.json();
    if (!part?.partName) {
      return new Response(JSON.stringify({ error: "part.partName is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Prefer the caller's own (already rich) template as the fallback, so a degraded
    // response is never worse than what the client would have built on its own.
    const fallback = clientFallback || fallbackPrompt(part, project);

    const GROQ_API_KEY_2 = Deno.env.get("GROQ_API_KEY_2");
    if (!GROQ_API_KEY_2) {
      // No second key configured yet — degrade gracefully rather than block STL generation.
      return new Response(JSON.stringify({ prompt: fallback, source: "fallback_no_key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You write CAD-generation prompts for an automated single-part manufacturing pipeline. Given one part's spec (as part of a larger multi-part project), write ONE detailed, unambiguous prompt describing exactly that part's geometry, features, and dimensions — precise enough that two different parts in the same project will never be described identically, even if their input specs look similar. Include: exact dimensions (infer sensible ones if missing, but make them specific numbers, not ranges), distinguishing geometric features (holes, fillets, mounting points, wall thickness, etc. appropriate to the part's function), material, and manufacturing method. Do not describe an assembly or other parts. Return ONLY the prompt text, no preamble, no markdown, no JSON.`;

    const userContent = `Project: ${project?.projectName || 'hardware project'} — ${project?.projectDescription || 'no further description'}
Part: ${part.partName}
Purpose: ${part.purpose || 'unspecified'}
Subsystem: ${part.subsystem || 'unspecified'}
Dimensions given: ${part.dimensions || 'none — infer reasonable exact dimensions'}
Material: ${part.material || 'unspecified'}
Manufacturing method: ${part.manufacturingMethod || 'CNC machining or 3D printing, whichever suits this part'}
Complexity: ${part.complexity || 'Beginner'}`;

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY_2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 500,
      }),
    });

    if (!groqResp.ok) {
      console.error("stl-prompt-generator: Groq call failed", groqResp.status, await groqResp.text());
      return new Response(JSON.stringify({ prompt: fallback, source: "fallback_groq_error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await groqResp.json();
    const prompt = result.choices?.[0]?.message?.content?.trim();

    if (!prompt) {
      return new Response(JSON.stringify({ prompt: fallback, source: "fallback_empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ prompt, source: "groq_key_2" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("stl-prompt-generator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
