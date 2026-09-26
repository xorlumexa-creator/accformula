const DESIGN_GENERATOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/design-generator`;
const AUTH_HEADER = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

// Calls design-generator in a non-streaming JSON mode (generate_macro_parts /
// generate_micro_parts / refine_parts). The streaming "interview" mode has its own
// fetch loop in ProjectPlanPage.tsx, since it needs to read the SSE body incrementally.
export async function callDesignGenerator(mode: string, body: Record<string, any>): Promise<any> {
  const resp = await fetch(DESIGN_GENERATOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
    body: JSON.stringify({ mode, ...body }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Request failed');
  return data;
}

// Reconstructs a best-effort brief from a `projects` row for the rare project created before
// brief_json existed. Only the fields that map onto dedicated columns are recoverable this
// way — connectivity/specialRequirements/assumptions/experienceLevel/country/cadSoftware are
// simply absent for those older rows.
export function briefFromProject(project: any): any {
  if (project?.brief_json) return project.brief_json;
  return {
    projectName: project?.project_name,
    description: project?.description,
    category: project?.category,
    purpose: project?.purpose,
    budget: project?.budget_range,
    budgetCurrency: project?.budget_currency,
    environment: project?.environment,
    targetWeight: project?.target_weight,
    targetSize: project?.target_size,
    powerSource: project?.power_source,
    controlMethod: project?.control_method,
    microcontroller: project?.microcontroller,
    has3dPrinter: project?.has_3d_printer,
  };
}
