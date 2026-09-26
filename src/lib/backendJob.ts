// Submits a design-generation request to the Render backend's ASYNC endpoint and polls it
// to completion, instead of making one long-lived fetch to the synchronous endpoint.
//
// Why this exists: /generate-validate-refine can now take several minutes per call (each
// refinement iteration runs a real SimScale cloud FEA solve, on top of the LLM call), and
// the backend's free-tier instance runs a single worker. A single fetch that blocks for
// minutes waiting on that one worker risks the browser/any proxy in front of Render timing
// the connection out, and — more importantly — ties up that one worker so nothing else
// (including the backend's own health check) can be served meanwhile. Posting to
// /generate-validate-refine-async instead returns a job_id immediately; the actual work runs
// as a background task, and polling GET /job/{id} is a cheap, near-instant dict lookup that
// the backend can answer even while a generation is running in a worker thread.
//
// This does not remove load from Render — the CAD/FEA compute itself has no equivalent that
// can run in a Supabase Edge Function (build123d and the SimScale client both need a real
// Python process, not Deno) — but it turns one long blocking request into a cheap
// submit-and-poll pattern the backend can actually serve concurrently.

export interface JobProgress {
  elapsedSeconds: number;
}

export interface PollJobOptions {
  /** Called on every poll tick with how long the job has been running. */
  onTick?: (progress: JobProgress) => void;
  /** Poll interval in ms. Default 5000 — SimScale runs take minutes, no need to poll faster. */
  intervalMs?: number;
  /** Give up (reject) after this many ms of polling. Default 25 minutes: generous enough for
   *  a few SimScale-backed refinement iterations, but bounded so a stuck job doesn't spin
   *  the tab forever. The job may still finish server-side after this — this only stops the
   *  browser from waiting on it. */
  timeoutMs?: number;
}

/** Extracts the most useful message out of a FastAPI-style JSON or plain-text error body. */
async function extractErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    const msg = parsed.detail ?? parsed.error ?? parsed.message ?? text;
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

/**
 * POSTs `form` to `${backendUrl}/generate-validate-refine-async`, then polls
 * `${backendUrl}/job/{job_id}` until it completes, fails, or times out.
 * Resolves with the final result object (the same shape /generate-validate-refine
 * itself returns: generated_stl_base64, refinement, health_score, ...).
 */
export async function submitAndPollJob(
  backendUrl: string,
  form: FormData,
  opts: PollJobOptions = {}
): Promise<any> {
  const { onTick, intervalMs = 5000, timeoutMs = 25 * 60 * 1000 } = opts;

  const submitRes = await fetch(`${backendUrl}/generate-validate-refine-async`, {
    method: 'POST',
    body: form,
  });
  if (!submitRes.ok) {
    throw new Error(await extractErrorMessage(submitRes));
  }
  const { job_id: jobId } = await submitRes.json();
  if (!jobId) throw new Error('Backend did not return a job_id.');

  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Still running after ${Math.round(timeoutMs / 60000)} minutes — giving up waiting in the ` +
        `browser. The job may still finish on the server; try again shortly.`
      );
    }

    await new Promise((r) => setTimeout(r, intervalMs));

    const jobRes = await fetch(`${backendUrl}/job/${jobId}`);
    if (!jobRes.ok) {
      // A transient 5xx while the backend is busy shouldn't kill the whole poll loop —
      // only a real error result (JOB_STORE status "error", handled below) should.
      // eslint-disable-next-line no-console
      console.warn(`Job poll returned HTTP ${jobRes.status}, retrying...`);
      continue;
    }

    const body = await jobRes.json();
    if (body?.status === 'running') {
      onTick?.({ elapsedSeconds: body.elapsed_seconds ?? Math.round((Date.now() - startedAt) / 1000) });
      continue;
    }

    // Anything else is the finished result object itself (see main.py's /job/{id}: it
    // unwraps JOB_STORE and returns the raw `result` dict on success, or raises an
    // HTTPException — caught by `!jobRes.ok` above — on failure).
    return body;
  }
}
