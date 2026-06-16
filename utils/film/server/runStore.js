// L2 Service API runtime: an async "run" model over the core agent operations.
//
// A run = one agent invocation. Long-running work (image batches, video) happens
// in the background; callers poll GET /runs/{id} (results grow incrementally) or
// receive a webhook on completion. The event log doubles as the run's trace (L5).
//
// v1 is intentionally lean: in-memory, process-local store (swap for Redis/Temporal
// later), apiKey passthrough, no tenancy. Agents are stateless — the caller's
// harness composes any loop (e.g. Story Director = storyBeats → animate → repeat).

import crypto from 'crypto';
import { CONFIG } from '../../config';
import { createDirectClient } from '../core/directClient';
import * as ops from '../core/operations';
import { runProduction } from '../core/orchestrator';

// Singleton across hot reloads.
const store = globalThis.__filmRunStore || (globalThis.__filmRunStore = {
  runs: new Map(),
});

// Append a lifecycle event to the run's trace. Polling (GET /runs/:id) surfaces
// both the growing `results` and this `events` trace — no live push needed.
const emit = (run, type, data) => {
  run.events.push({ seq: run.events.length, t: Date.now(), type, ...(data !== undefined ? { data } : {}) });
};

// Map an agent id to a core operation; collect typed results + stream item events.
const runAgent = async (agent, input, ctx, onEvent) => {
  switch (agent) {
    case 'inspiration':
    case 'characterVariations':
    case 'locationVariations':
    case 'mixMatch': {
      const items = [];
      const op = ops[agent];
      const { errors } = await op(input, ctx, (item) => { items.push(item); onEvent('asset', item); });
      return { results: items, usage: { created: items.length, errors } };
    }
    case 'animate': {
      const { taskId, prompt } = await ops.animate(input, ctx);
      onEvent('video.queued', { taskId });
      const { videoUrl } = await ctx.client.pollVideo({ taskId });
      const item = { kind: 'video', url: videoUrl, prompt };
      onEvent('asset', item);
      return { results: [item], usage: { created: 1 } };
    }
    case 'promptMuse': {
      const { text } = await ops.promptMuse(input, ctx);
      return { results: [{ kind: 'text', text }], usage: { created: 1 } };
    }
    case 'storyBeats': {
      const beats = await ops.suggestNextBeats(input, ctx);
      return { results: beats, usage: { created: beats.length } };
    }
    case 'autoDirector': {
      // The headless PIPELINE: cast → storyboard → direct-to-video → stitch.
      // Callers may pass their own real anchors as input.bible [{ role, url,
      // name }]; otherwise the minimum cast is generated once. Server stitch
      // (ffmpeg + TOS) makes the result a hosted film URL.
      const serverStitch = async (shotUrls, o = {}) => {
        const { stitchShots } = await import('./stitch');
        const out = await stitchShots({ shots: shotUrls, name: o.name });
        return { url: out.url };
      };
      const result = await runProduction(
        { idea: input.idea, bible: input.bible, targetSeconds: input.targetSeconds, targetMinutes: input.targetMinutes },
        { client: ctx.client, stitch: serverStitch },
        {
          config: input.config,
          perStepCount: input.perStepCount,
          qc: input.qc,
          // Map production events into the run trace; picked outputs grow `results`.
          onEvent: (e) => {
            if (e.type === 'asset') onEvent('asset', { kind: e.kind, url: e.url, stepId: e.stepId });
            else onEvent(e.type, e);
          },
        },
      );
      return {
        results: result, // { bible, panels, plan, shots, assets, film? }
        usage: { panels: result.panels.length, steps: result.plan.length, shots: result.shots.length, film: result.film ? 1 : 0 },
      };
    }
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
};

const fireWebhook = async (url, run) => {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id, status: run.status, agent: run.agent, results: run.results, error: run.error, usage: run.usage }),
    });
  } catch { /* webhook delivery is best-effort in v1 */ }
};

const execute = async (run, { apiKey, baseUrl }) => {
  run.status = 'running';
  run.startedAt = Date.now();
  run.results = []; // grows as assets land, so pollers see incremental progress
  emit(run, 'running');
  try {
    const ctx = { client: createDirectClient({ apiKey, baseUrl: baseUrl || CONFIG.API_BASE_URL }) };
    const onEvent = (type, data) => {
      if (type === 'asset') run.results.push(data);
      emit(run, type, data);
    };
    const { results, usage } = await runAgent(run.agent, { ...run.input, config: run.config }, ctx, onEvent);
    run.results = results; // authoritative final
    run.usage = usage;
    run.status = 'succeeded';
    emit(run, 'succeeded', { resultCount: results.length });
  } catch (err) {
    run.status = 'failed';
    run.error = err.message;
    emit(run, 'failed', { error: err.message });
  } finally {
    run.endedAt = Date.now();
    fireWebhook(run.webhookUrl, run);
  }
};

export const createRun = ({ agent, input = {}, config, apiKey, baseUrl, webhookUrl }) => {
  const run = {
    id: `run_${crypto.randomBytes(8).toString('hex')}`,
    agent,
    input,
    config: config || {},
    webhookUrl: webhookUrl || null,
    status: 'queued',
    results: null,
    error: null,
    usage: null,
    events: [],
    createdAt: Date.now(),
  };
  store.runs.set(run.id, run);
  emit(run, 'queued');
  // Fire and forget — the API responds immediately with the run id.
  execute(run, { apiKey, baseUrl });
  return run;
};

export const getRun = (id) => store.runs.get(id) || null;

// Public-safe view. `events` is the inspectable trace (lifecycle + timings);
// `results` grows incrementally so polling reflects progress mid-run.
export const publicRun = (run) => ({
  id: run.id,
  agent: run.agent,
  status: run.status,
  results: run.results,
  error: run.error,
  usage: run.usage,
  events: run.events,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
});
