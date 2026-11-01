// WHAT HOLDS WHATEVER THE MODEL DECIDES, per run of the agent. A model told to report a failed render
// and stop keeps trying other ways to get it, so the harness counts: past these limits the tool is
// refused, and the refusal tells the model to report.

export const RUN_LIMITS = { calls: 60, failedRenders: 2, errors: 6, hardStopAfter: 5 };

export const RENDERS = ['generate_image', 'edit_image', 'cast', 'variations', 'scene_views', 'storyboard', 'previz', 'generate_video', 'edit_video', 'previz_animatic', 'finish'];
const REPORT = 'Start no more work. Tell the director plainly what is done, what is not and why.';

// A connection that dropped says nothing about the call: the same call can work a moment later.
export const isNetworkError = (message) => /fetch failed|socket|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|TLS connection|network|timed out|terminated/i.test(String(message));

export const createRunRules = (limits = RUN_LIMITS) => {
  let calls = 0;
  let errors = 0;
  const failed = new Set();
  const seen = new Set();
  const blocked = new Map();
  const closedSources = new Map();
  const videosIn = (params = {}) => [params.source, ...(params.video_refs || [])].filter(Boolean).map((n) => String(n).toUpperCase());
  const namesFailed = (out) => [out, ...(out?.results || [])].filter((r) => r?.status === 'failed' && r.name).map((r) => r.name);

  return {
    // A reason to refuse this call, or nothing. A refusal is not counted as work done.
    before: (tool, params) => {
      calls += 1;
      if (calls > limits.calls) return `This run reached its limit of ${limits.calls} tool calls. ${REPORT}`;
      if (errors >= limits.errors) return `This run has had ${errors} tool errors. ${REPORT}`;
      if (blocked.has(tool)) return `${tool} is closed for this run: ${blocked.get(tool)} ${REPORT}`;
      // A source that was refused stays refused: another route to the same result is not an answer.
      const closed = videosIn(params).find((n) => closedSources.has(n));
      if (RENDERS.includes(tool) && closed) return `${closed} was refused: ${closedSources.get(closed)} Don't render from it another way. ${REPORT}`;
      if (RENDERS.includes(tool) && failed.size >= limits.failedRenders) return `${failed.size} renders failed in this run (${[...failed].join(', ')}). ${REPORT}`;
      return '';
    },
    after: (out) => namesFailed(out).forEach((n) => failed.add(n)),
    // The same refusal twice means nothing changed for it to work: that tool closes for the run.
    // The call limit still bounds a connection that stays down.
    error: (tool, message, params) => {
      if (isNetworkError(message)) return;
      errors += 1;
      if (RENDERS.includes(tool)) videosIn(params).forEach((n) => { if (message.startsWith(n)) closedSources.set(n, message); });
      const key = `${tool}:${message}`;
      if (seen.has(key)) blocked.set(tool, message);
      seen.add(key);
    },
    // Past this the model is ignoring refusals, and the run is ended from outside.
    mustAbort: () => calls > limits.calls + limits.hardStopAfter,
    stats: () => ({ calls, errors, failed: [...failed] }),
  };
};
