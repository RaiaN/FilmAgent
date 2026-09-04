// Run trace — agent introspection / decision history. Records every PROMPT, every
// ACTION, and every DECISION taken during an Ad run, structured as
// workflow → step → action, so the whole pipeline is transparent and inspectable.
//
// Pure + node-free. Two capture paths feed one ordered log:
//   1. wrapClient(client) — wraps the injected transport (the single choke point every
//      model call passes through: reason/generateImage/startVideo/pollVideo) → captures
//      the actual prompt, role-annotated references, model, result, timing, errors.
//   2. ingestSessionEvent(e) — folds the production session's events (plan, phase,
//      per-step status, QC verdicts, final cut) → the DECISIONS the call log can't see.
// startRun/setStep stamp run+step context onto every entry so the panel can nest them.
// subscribe(fn) drives a live-updating UI. No React, no network.

import { modelLabelOf } from '../suiteConfig';

const now = () => Date.now();
const CAP = 72;

// Compact, dump-friendly rendering of a reference URL: base64 → "data(mime,~NKB)",
// http → last path segment, anything long → truncated. Keeps the log readable.
export const abbrevUrl = (u) => {
  if (typeof u !== 'string') return String(u);
  if (u.startsWith('data:')) {
    const semi = u.indexOf(';');
    const mime = semi > 5 ? u.slice(5, semi) : 'data';
    return `data(${mime},~${Math.round(u.length / 1024)}KB)`;
  }
  if (/^https?:/i.test(u)) {
    try { const seg = new URL(u).pathname.split('/').filter(Boolean).pop() || u; return seg.length > CAP ? `${seg.slice(0, CAP)}…` : seg; }
    catch { return u.slice(0, CAP); }
  }
  return u.length > CAP ? `${u.slice(0, CAP)}…` : u;
};

const oneLine = (s, n = 280) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// WHICH SKILL RODE. The system prompt carries a bound skill inside a <<<SPEC … SPEC>>>
// fence; read its frontmatter name and weight so the run log SHOWS the vendor spec was
// sent, instead of the caller having to take it on faith. No fence → no skill.
const skillOf = (sys) => {
  const str = String(sys || '');
  const i = str.indexOf('<<<SPEC');
  if (i < 0) return '';
  const j = str.indexOf('SPEC>>>', i);
  const body = str.slice(i + 7, j < 0 ? str.length : j);
  const m = /^name:\s*(.+)$/m.exec(body);
  return `${m ? m[1].trim() : 'skill'} · ${Math.round(body.length / 4).toLocaleString()} tok`;
};

export const createTrace = () => {
  const entries = [];
  const listeners = new Set();
  let t0 = null;
  let resolveRole = null; // (url) => role | null — tag each ref with its bible role
  // Run/step context — stamped onto every entry so the inspector can nest
  // workflow → step → action. Set by startRun / setStep / ingestSessionEvent.
  let runSeq = 0;
  let curRun = null;
  let curStep = null;
  const stepTitleById = new Map();
  const loggedQc = new Set();

  const notify = () => { listeners.forEach((l) => { try { l(); } catch { /* never break a run */ } }); };

  const push = (e) => {
    const t = now();
    if (t0 == null) t0 = t;
    const rec = {
      seq: entries.length + 1, t, dt: (t - t0) / 1000,
      ...e,
      runId: e.runId != null ? e.runId : curRun,
      // Run-level decisions (plan/phase/film/warning/run.start) never nest under a
      // step, even if a step context is still set when they fire.
      stepId: e.level === 'run' ? null : (e.stepId != null ? e.stepId : curStep),
    };
    entries.push(rec);
    notify();
    return rec; // returned so async callers can patch status/result/error in place
  };

  // ---- workflow / step context ----------------------------------------------
  // A workflow = one user-initiated operation (Build brand kit, Generate gap,
  // Generate the ad, Fill clip). startRun opens one; setStep scopes subsequent
  // actions to a producer step so calls nest under the agent that made them.
  const startRun = (meta = {}) => {
    runSeq += 1; curRun = runSeq; curStep = null;
    push({ level: 'run', kind: 'run.start', runId: curRun, ...meta });
    return curRun;
  };
  const setStep = (id, title, agent) => {
    curStep = id || null;
    if (id && title) stepTitleById.set(id, title);
    if (id && agent) stepTitleById.set(`${id}::agent`, agent);
    return curStep;
  };

  // Annotate reference urls with their bible role so leaks read clearly:
  // "character:face.jpg" feeding a location shot is the smell we're hunting.
  const refsWithRoles = (urls) => (urls || []).filter(Boolean).map((u) => {
    const role = resolveRole ? resolveRole(u) : null;
    return role ? `${role}:${abbrevUrl(u)}` : abbrevUrl(u);
  });

  // ---- transport call capture (the actual prompts + refs the models got) ------
  const wrapClient = (client) => {
    if (!client) return client;
    const timed = async (kind, info, fn) => {
      const started = now();
      const rec = push({ kind, ...info, status: 'running' });
      try {
        const out = await fn();
        rec.status = 'ok';
        rec.ms = now() - started;
        if (kind === 'generateImage') rec.result = abbrevUrl(out && out.url);
        else if (kind === 'reason') {
          // The one-line result is the row's PREVIEW; resultFull is what the model
          // actually said, whole and unflattened. A reasoner answer is the thing you
          // most need to read when a shot comes back wrong, and a 360-char slice with
          // its newlines collapsed is exactly where JSON and screenplays stop being
          // readable. The panel prints the full text; the preview keeps the row short.
          rec.result = oneLine(out && out.content, 360);
          rec.resultFull = String((out && out.content) || '');
        }
        else if (kind === 'startVideo') rec.result = `task ${(out && out.taskId) || '?'}`;
        else if (kind === 'pollVideo') rec.result = abbrevUrl(out && out.videoUrl);
        else if (kind === 'generateSpeech') rec.result = `${(out && out.bytes) || 0} bytes · ${(out && out.format) || 'mp3'}`;
        notify();
        return out;
      } catch (err) {
        rec.status = 'error';
        rec.ms = now() - started;
        rec.error = err.message;
        notify();
        throw err;
      }
    };
    return {
      ...client,
      reason: (args = {}) => timed('reason', { prompt: oneLine(args.prompt), system: oneLine(args.systemPrompt, 90), skill: skillOf(args.systemPrompt), refs: refsWithRoles(args.images), model: modelLabelOf(args.modelId), modelId: args.modelId }, () => client.reason(args)),
      generateImage: (args = {}) => timed('generateImage', { prompt: oneLine(args.prompt), refs: refsWithRoles(args.referenceImages), model: modelLabelOf(args.model), modelId: args.model, size: args.size }, () => client.generateImage(args)),
      startVideo: (args = {}) => timed('startVideo', { prompt: oneLine((args.content || []).map((c) => c && c.text).filter(Boolean).join(' ')), model: modelLabelOf(args.model), modelId: args.model, duration: args.duration, resolution: args.resolution }, () => client.startVideo(args)),
      pollVideo: (args = {}) => timed('pollVideo', { task: args.taskId }, () => client.pollVideo(args)),
      ...(client.generateSpeech ? { generateSpeech: (args = {}) => timed('generateSpeech', { prompt: oneLine(args.text) }, () => client.generateSpeech(args)) } : {}),
    };
  };

  const wrapStitch = (stitchFn) => {
    if (typeof stitchFn !== 'function') return stitchFn;
    return async (urls, opts) => {
      const started = now();
      const rec = push({ kind: 'stitch', shots: (urls || []).length, status: 'running' });
      try {
        const out = await stitchFn(urls, opts);
        rec.status = 'ok'; rec.ms = now() - started; rec.result = abbrevUrl(out && out.url); notify();
        return out;
      } catch (err) {
        rec.status = 'error'; rec.ms = now() - started; rec.error = err.message; notify();
        throw err;
      }
    };
  };

  // ---- production-session decisions (plan, phase, step status, QC, final cut) --
  // Call this alongside the canvas's own event handling. It records the DECISIONS the
  // transport-level call log can't see, and sets the step context so subsequent model
  // calls nest under the agent/step that made them.
  const ingestSessionEvent = (e) => {
    if (!e || !e.type) return;
    if (e.type === 'plan' || (e.type === 'state' && e.state && Array.isArray(e.state.plan))) {
      const plan = e.plan || e.state.plan;
      plan.forEach((s) => { if (s.id && (s.title || s.agent)) stepTitleById.set(s.id, s.title || s.agent); });
      if (e.type === 'plan') {
        push({ level: 'run', kind: 'plan', note: `${plan.length} step${plan.length === 1 ? '' : 's'} planned`, plan: plan.map((s, i) => `${i + 1}. ${s.agent}: ${oneLine(s.title || s.intent || '', 64)}`).join('  |  ') });
      }
      plan.forEach((s) => {
        if (s.qc && s.qc.verdict && !loggedQc.has(s.id)) {
          loggedQc.add(s.id);
          const issues = (s.qc.issues || []).map((it) => it && it.message).filter(Boolean).join('; ');
          push({ level: 'step', kind: 'qc', stepId: s.id, stepTitle: stepTitleById.get(s.id), note: `QC ${s.qc.verdict}${issues ? `: ${issues}` : ''}` });
        }
      });
      return;
    }
    if (e.type === 'phase') { push({ level: 'run', kind: 'phase', note: e.phase }); return; }
    if (e.type === 'step') {
      const title = stepTitleById.get(e.stepId) || e.agent;
      if (e.status === 'running') {
        setStep(e.stepId, title, e.agent);
        push({ level: 'step', kind: 'step.running', stepId: e.stepId, stepTitle: title, agent: e.agent, note: e.total ? `shot ${(e.index ?? 0) + 1}/${e.total}` : '' });
      } else if (e.status === 'failed') {
        push({ level: 'step', kind: 'step.failed', stepId: e.stepId, stepTitle: title, agent: e.agent, error: e.message });
      } else if (e.status === 'skipped') {
        push({ level: 'step', kind: 'step.skipped', stepId: e.stepId, stepTitle: title, agent: e.agent, note: e.message });
      } else if (e.status === 'approved') {
        push({ level: 'step', kind: 'step.approved', stepId: e.stepId, stepTitle: title, agent: e.agent });
      }
      return;
    }
    if (e.type === 'film') { push({ level: 'run', kind: 'film', note: `${e.shots || ''} shots stitched`.trim(), result: abbrevUrl(e.url || e.path) }); return; }
    if (e.type === 'warning') { push({ level: 'run', kind: 'warning', note: e.message }); }
  };

  // ---- nest the flat log into workflows → steps → actions (for the panel) ------
  const groups = () => {
    const runs = [];
    const runById = new Map();
    let misc = null;
    const ensureMisc = () => {
      if (!misc) { misc = { runId: null, title: 'Other actions', meta: null, steps: [], stepById: new Map(), actions: [] }; runs.push(misc); }
      return misc;
    };
    entries.forEach((e) => {
      let run = e.runId != null ? runById.get(e.runId) : null;
      if (e.runId != null && !run) {
        run = { runId: e.runId, title: null, meta: null, steps: [], stepById: new Map(), actions: [] };
        runById.set(e.runId, run); runs.push(run);
      }
      if (!run) run = ensureMisc();
      if (e.kind === 'run.start') { run.title = e.note || e.title || 'Workflow'; run.meta = e; return; }
      if (e.stepId != null) {
        let st = run.stepById.get(e.stepId);
        if (!st) { st = { stepId: e.stepId, title: e.stepTitle || e.stepId, agent: e.agent || null, status: null, actions: [] }; run.stepById.set(e.stepId, st); run.steps.push(st); }
        if (e.stepTitle) st.title = e.stepTitle;
        if (e.agent) st.agent = e.agent;
        if (typeof e.kind === 'string' && e.kind.indexOf('step.') === 0) st.status = e.kind.slice(5);
        st.actions.push(e);
      } else {
        run.actions.push(e);
      }
    });
    return runs;
  };

  // ---- text dump (hierarchical, paste-friendly) -------------------------------
  const toText = () => {
    if (!entries.length) return 'ModelArk Ad — decision history\n(no actions recorded yet — run something, then export again)\n';
    const out = ['ModelArk Ad — decision history (workflow → step → action)', `exported: ${new Date().toISOString()}`, `actions: ${entries.length}`, '═'.repeat(64)];
    const renderAction = (e, indent) => {
      const pad = ' '.repeat(indent);
      const bits = [];
      if (e.agent && e.stepId == null) bits.push(`agent=${e.agent}`);
      if (e.role) bits.push(`role=${e.role}`);
      if (e.model) bits.push(`model=${e.model}`);
      if (e.size) bits.push(`size=${e.size}`);
      if (e.shots != null) bits.push(`shots=${e.shots}`);
      if (e.ms != null) bits.push(`${e.ms}ms`);
      out.push(`${pad}[+${e.dt.toFixed(1)}s] ${e.kind}${e.status && e.status !== 'ok' ? ` (${e.status})` : ''}${bits.length ? `  ${bits.join(' ')}` : ''}`);
      if (e.note) out.push(`${pad}    ${e.note}`);
      if (e.plan) out.push(`${pad}    plan: ${e.plan}`);
      if (e.prompt) out.push(`${pad}    prompt: ${e.prompt}`);
      if (e.skill) out.push(`${pad}    skill:  ${e.skill}`);
      if (e.refs && e.refs.length) out.push(`${pad}    refs:   ${e.refs.join(', ')}`);
      if (e.assignments) out.push(`${pad}    → ${e.assignments}`);
      // The export is what gets pasted into a bug report, so the reasoner's answer
      // rides WHOLE here — the one-line preview is a UI affordance, not the record.
      if (e.resultFull && e.resultFull.length > String(e.result || '').length) {
        out.push(`${pad}    → output (${e.resultFull.length} chars):`);
        e.resultFull.split('\n').forEach((ln) => out.push(`${pad}      | ${ln}`));
      } else if (e.result) out.push(`${pad}    → ${e.result}`);
      if (e.error) out.push(`${pad}    ✗ ${e.error}`);
    };
    groups().forEach((run) => {
      out.push('', `▸ WORKFLOW: ${run.title || `run ${run.runId || ''}`}`);
      run.actions.forEach((e) => renderAction(e, 2));
      run.steps.forEach((st) => {
        out.push(`  • STEP: ${st.title}${st.agent ? ` [${st.agent}]` : ''}${st.status ? ` — ${st.status}` : ''}`);
        st.actions.forEach((e) => renderAction(e, 4));
      });
    });
    return `${out.join('\n')}\n`;
  };

  return {
    entries,
    log: (e) => push(e),
    startRun,
    setStep,
    ingestSessionEvent,
    setRoleResolver: (fn) => { resolveRole = typeof fn === 'function' ? fn : null; },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    wrapClient,
    wrapStitch,
    groups,
    toText,
    clear: () => { entries.length = 0; t0 = null; curRun = null; curStep = null; runSeq = 0; stepTitleById.clear(); loggedQc.clear(); notify(); },
  };
};
