// Looks at renders of a finished assembly and says whether it looks right. The renders come from the assembly page's own 3D
// view (the exact geometry the backend solved); the measured facts (placements, mates, hardware, overlaps) are sent along so
// the model compares what it SEES with what was MEASURED instead of guessing. It never invents numbers: it reports problems.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// First match wins; set VISION_MODEL to put your own first. A model that is gone or rejects images is skipped.
const MODELS = [
  Deno.env.get("VISION_MODEL"),
  "qwen/qwen3.8-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
].filter(Boolean) as string[];

const SYSTEM = `You inspect renders of a mechanical assembly for a design tool. The parts are coloured boxes/shells; the user also gives
you MEASURED FACTS from the CAD solver. The renders are only a sanity check on those facts.
Look for: a part floating away from the part it should be attached to; a part sticking through another; a part upside down or
turned the wrong way; a missing screw or bolt where two parts are joined; a cavity that looks too small for what goes in it;
parts that look like they do not belong together. Say what you can SEE. If a render is too small or unclear to judge something,
say so instead of guessing. Never invent a dimension; only quote numbers that appear in the measured facts.
Answer with ONE JSON object and nothing else:
{"verdict":"ok"|"issues"|"unclear","summary":"2-3 sentences","issues":[{"severity":"high"|"medium"|"low","part":"<part name or 'assembly'>","what":"what is wrong, as seen","fix":"what to change"}]}
Use "ok" only when every view shows the parts joined sensibly. An empty issues list goes with "ok" or "unclear".`;

function extractJson(text: string) {
  const t = text.replace(/^```(?:json)?|```$/gm, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("the model did not return JSON");
  return JSON.parse(t.slice(a, b + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const { images, facts } = await req.json();
    if (!Array.isArray(images) || images.length === 0) return json({ error: "send at least one image" }, 400);
    const imgs = images.slice(0, 3).filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"));
    if (imgs.length === 0) return json({ error: "images must be data:image/... URLs" }, 400);
    if (imgs.some((s: string) => s.length > 3_000_000)) return json({ error: "an image is too large (limit about 2 MB)" }, 413);
    const factsText = JSON.stringify(facts ?? {}).slice(0, 9000);

    const keys = [Deno.env.get("GROQ_API_KEY"), Deno.env.get("GROQ_API_KEY_2"), Deno.env.get("GROQ_API_KEY_3")].filter(Boolean) as string[];
    if (keys.length === 0) return json({ error: "GROQ_API_KEY is not set for this function" }, 500);

    const content = [
      { type: "text", text: `MEASURED FACTS (JSON):\n${factsText}\n\nThe ${imgs.length} image(s) are different views of this assembly, in this order: ${
        (facts?.view_names ?? []).join(", ") || "iso, top, side"}.` },
      ...imgs.map((url: string) => ({ type: "image_url", image_url: { url } })),
    ];

    let lastError = "no vision model answered";
    for (const model of MODELS) {
      for (const key of keys) {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0.1, max_tokens: 900,
            messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] }),
        });
        if (resp.status === 429) { lastError = `${model}: rate limited`; continue; }          // next key
        if (!resp.ok) { lastError = `${model}: ${resp.status} ${(await resp.text()).slice(0, 160)}`; break; }   // next model
        const data = await resp.json();
        try {
          const out = extractJson(data.choices?.[0]?.message?.content ?? "");
          const verdict = ["ok", "issues", "unclear"].includes(out.verdict) ? out.verdict : "unclear";
          return json({ verdict, summary: String(out.summary ?? ""), issues: Array.isArray(out.issues) ? out.issues.slice(0, 12) : [], model });
        } catch (e) {
          lastError = `${model}: ${(e as Error).message}`;
          break;
        }
      }
    }
    return json({ error: `vision check failed (${lastError})` }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
