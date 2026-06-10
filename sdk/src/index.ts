// @modelark/film — plug-and-play client for the agentic film suite.
//
//   const film = new FilmSuite({ apiKey, baseUrl });
//   const refs   = await film.inspiration({ prompt: 'arctic outpost, 16mm' });
//   const beats  = await film.storyBeats({ idea, steps });
//   const shot   = await film.animate({ imageUrl, motion: 'slow push-in' },
//                                     { onEvent: (e) => console.log(e.type) });
//
// Every call submits an async run to the Service API and resolves with the final
// results — streaming lifecycle events via SSE when `onEvent` is supplied,
// otherwise polling. No UI, no canvas, no orchestration logic on the client.

import type {
  AgentId, AgentInput, FilmSuiteOptions, RunOptions, Run, RunEvent,
  InspirationInput, VariationsInput, MixMatchInput, AnimateInput, PromptMuseInput, StoryBeatsInput,
  ImageAsset, VideoAsset, TextAsset, Beat, SuiteConfigOverride,
} from './types';

export * from './types';

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
}

export default FilmSuite;
