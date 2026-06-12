// @modelark/film — plug-and-play SDK for the agentic film suite.
//
// Two layers:
//   • Single agents — submit async runs to the Service API:
//       const film = new FilmSuite({ apiKey, baseUrl });
//       const refs  = await film.inspiration({ prompt: 'arctic outpost, 16mm' });
//   • Full production — the whole Auto Director loop, in-process, no Service API:
//       const result = await produce(
//         { idea: 'a lonely lighthouse keeper and a stranded whale', targetMinutes: 1 },
//         { onEvent: (e) => console.log(e.type) },
//       );
//       // result.film?.path → the stitched .mp4
//
// produce() runs understand → plan → generate shots → QC → stitch directly against
// ModelArk via an injected transport. The agent ops are reused verbatim from the
// shared core; only the orchestration loop is owned here.

import type {
  AgentId, AgentInput, FilmSuiteOptions, RunOptions, Run, RunEvent,
  InspirationInput, VariationsInput, MixMatchInput, AnimateInput, PromptMuseInput, StoryBeatsInput,
  ImageAsset, VideoAsset, TextAsset, Beat, SuiteConfigOverride,
  ProduceInput, ProduceOptions, ProduceResult, AutoDirectorInput,
  Production, ProductionOptions, StitchFn,
} from './types';
import { runProduction, createProduction as createProductionCore } from './core';
import { createDirectTransport } from './transport';

export * from './types';
export { createDirectTransport } from './transport';
export { runStep } from './core';
export type { Transport } from './transport';
export type { Client, Ctx } from './core';

// The bundled Node ffmpeg stitch, lazy-loaded on first use so browser consumers of
// the HTTP client never pull in node built-ins, and so createProduction() can stay
// synchronous. A caller-supplied opts.stitch fn (or `false`) takes precedence.
const lazyNodeStitch: StitchFn = (shots, o) => import('./stitch').then((m) => m.nodeStitch(shots, o));
const defaultStitch = (s: StitchFn | false | undefined): StitchFn | undefined =>
  (s === undefined ? lazyNodeStitch : undefined); // `false` → no stitch; a fn → used via opts by the session

/**
 * Produce a full film headlessly: understand → plan → generate shots → QC → stitch,
 * running the entire agentic loop in-process via a direct-to-ModelArk transport —
 * no Service API required. Node runtime (stitching shells out to ffmpeg).
 *
 * `apiKey`/`baseUrl` default to env `MODELARK_API_KEY` / `MODELARK_API_BASE_URL`.
 */
export async function produce(input: ProduceInput, opts: ProduceOptions = {}): Promise<ProduceResult> {
  const transport = createDirectTransport({ apiKey: opts.apiKey, baseUrl: opts.baseUrl, stitch: defaultStitch(opts.stitch) });
  return runProduction(input, transport, opts);
}

/**
 * Open an INTERACTIVE production you drive step by step (understand → plan → runStep →
 * pick/approve/regenerate/skip → stitch), or call `.runAll()` for the autonomous loop.
 * Same engine as `produce()`; here you own the control flow — build any UI on top.
 * Defaults to `mode: 'review'`. `apiKey`/`baseUrl` default to env like `produce()`.
 */
export function createProduction(
  input: ProduceInput,
  opts: ProductionOptions & { apiKey?: string; baseUrl?: string } = {},
): Production {
  const transport = createDirectTransport({ apiKey: opts.apiKey, baseUrl: opts.baseUrl, stitch: defaultStitch(opts.stitch) });
  return createProductionCore(input, transport, opts);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FilmSuiteError extends Error {
  constructor(message: string, readonly run?: Run) { super(message); this.name = 'FilmSuiteError'; }
}

export class FilmSuite {
  private apiKey: string;
  private baseUrl: string;
  private config?: SuiteConfigOverride;
  private fetchImpl: typeof fetch;

  constructor(opts: FilmSuiteOptions) {
    if (!opts?.apiKey) throw new Error('FilmSuite: apiKey is required');
    if (!opts?.baseUrl) throw new Error('FilmSuite: baseUrl is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.config = opts.config;
    this.fetchImpl = opts.fetch || globalThis.fetch;
    if (!this.fetchImpl) throw new Error('FilmSuite: no fetch available; pass opts.fetch');
  }

  private headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }

  /** Generic: start an agent run and resolve with its results. */
  async run<R = unknown>(agent: AgentId, input: AgentInput, opts: RunOptions = {}): Promise<R> {
    const config = { ...this.config, ...opts.config };
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ agent, input, config, webhookUrl: opts.webhookUrl }),
      signal: opts.signal,
    });
    const created = await res.json();
    if (!res.ok) throw new FilmSuiteError(created?.error || `Run create failed (HTTP ${res.status})`);
    const runId: string = created.id;

    const finished = await this.poll(runId, opts.pollIntervalMs ?? 2500, opts.onEvent, opts.signal);
    if (finished.status === 'failed') throw new FilmSuiteError(finished.error || 'Run failed', finished);
    return finished.results as R;
  }

  /** Fetch a run's current state (status, results-so-far, and the event trace). */
  async getRun(id: string): Promise<Run> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/runs/${id}`, { headers: this.headers() });
    const data = await res.json();
    if (!res.ok) throw new FilmSuiteError(data?.error || `getRun failed (HTTP ${res.status})`);
    return data as Run;
  }

  // Poll until terminal. New trace events are surfaced to onEvent as they appear,
  // so progress is visible without any streaming connection.
  private async poll(id: string, intervalMs: number, onEvent?: (e: RunEvent) => void, signal?: AbortSignal): Promise<Run> {
    let lastSeq = -1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) throw new FilmSuiteError('Aborted');
      const run = await this.getRun(id);
      if (onEvent && Array.isArray(run.events)) {
        for (const ev of run.events) {
          if (ev.seq > lastSeq) { lastSeq = ev.seq; onEvent(ev); }
        }
      }
      if (run.status === 'succeeded' || run.status === 'failed') return run;
      await sleep(intervalMs);
    }
  }

  // ---- typed convenience methods ----
  inspiration(input: InspirationInput, opts?: RunOptions) { return this.run<ImageAsset[]>('inspiration', input, opts); }
  characterVariations(input: VariationsInput, opts?: RunOptions) { return this.run<ImageAsset[]>('characterVariations', input, opts); }
  locationVariations(input: VariationsInput, opts?: RunOptions) { return this.run<ImageAsset[]>('locationVariations', input, opts); }
  mixMatch(input: MixMatchInput, opts?: RunOptions) { return this.run<ImageAsset[]>('mixMatch', input, opts); }
  animate(input: AnimateInput, opts?: RunOptions) { return this.run<VideoAsset[]>('animate', input, opts); }
  promptMuse(input: PromptMuseInput, opts?: RunOptions) { return this.run<TextAsset[]>('promptMuse', input, opts); }
  storyBeats(input: StoryBeatsInput, opts?: RunOptions) { return this.run<Beat[]>('storyBeats', input, opts); }

  /**
   * Run the full headless production loop (see standalone `produce`). Uses this
   * suite's apiKey. Note: this talks to ModelArk directly, NOT the Service API —
   * set `opts.baseUrl` (or env MODELARK_API_BASE_URL) to the ModelArk endpoint.
   */
  produce(input: ProduceInput, opts: ProduceOptions = {}) {
    return produce(input, { apiKey: this.apiKey, ...opts });
  }

  /**
   * Run the full production on the **Service API** (server-side) and resolve with
   * the finished film — for thin clients that don't run the loop themselves.
   * Contrast with `produce()`, which runs the loop in *this* process.
   */
  autoDirector(input: AutoDirectorInput, opts?: RunOptions) {
    return this.run<ProduceResult>('autoDirector', input, opts);
  }

  /** Open an interactive production (in-process engine) using this suite's apiKey. */
  createProduction(input: ProduceInput, opts: ProductionOptions = {}) {
    return createProduction(input, { apiKey: this.apiKey, ...opts });
  }
}

export default FilmSuite;
