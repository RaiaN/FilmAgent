// Public types for the @modelark/film SDK.

export type AgentId =
  | 'inspiration'
  | 'characterVariations'
  | 'locationVariations'
  | 'mixMatch'
  | 'animate'
  | 'promptMuse'
  | 'storyBeats'
  | 'autoDirector';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Optional per-suite / per-call overrides of the root SuiteConfig. */
export interface SuiteConfigOverride {
  models?: Partial<Record<'seedream' | 'seedance' | 'reasoner', string>>;
  prompts?: Record<string, string>;
  defaults?: Record<string, Record<string, unknown>>;
  runtime?: { pollIntervalMs?: number; timeoutMs?: number; defaultImageSize?: string; reasoningEffort?: 'low' | 'medium' | 'high' | null };
}

// ---- per-agent inputs ----
export interface InspirationInput { prompt?: string; refs?: string[]; count?: number; size?: string; }
export interface VariationsInput { imageUrl: string; axis?: string; count?: number; notes?: string; size?: string; }
export interface MixMatchInput { imageUrls: string[]; direction?: string; count?: number; size?: string; }
export interface AnimateInput {
  imageUrl?: string; assetId?: string; motion?: string;
  camera?: string; lens?: string; focalLength?: string; aperture?: string;
  duration?: number | 'auto'; resolution?: string; ratio?: string; generateAudio?: boolean;
}
export interface PromptMuseInput { images?: string[]; video?: string; question?: string; }
export interface StoryBeatsInput { idea?: string; steps?: string[]; lastImageUrl?: string; count?: number; }

export type AgentInput =
  | InspirationInput | VariationsInput | MixMatchInput
  | AnimateInput | PromptMuseInput | StoryBeatsInput
  | AutoDirectorInput;

// ---- results ----
export interface ImageAsset { kind?: 'image'; url: string; prompt?: string; label?: string; meta?: Record<string, unknown>; }
export interface VideoAsset { kind: 'video'; url: string; prompt?: string; }
export interface TextAsset { kind: 'text'; text: string; }
export interface Beat { title: string; prompt: string; }

export interface RunEvent {
  seq: number;
  t: number;
  type: 'queued' | 'running' | 'asset' | 'video.queued' | 'succeeded' | 'failed' | string;
  data?: unknown;
}

export interface Run<R = unknown> {
  id: string;
  agent: AgentId;
  status: RunStatus;
  results: R | null;
  error: string | null;
  usage: { created?: number; errors?: string[] } | null;
  events?: RunEvent[];
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface FilmSuiteOptions {
  apiKey: string;
  /** Base URL of the Service API (e.g. https://your-host). */
  baseUrl: string;
  /** Suite-wide config override applied to every call. */
  config?: SuiteConfigOverride;
  fetch?: typeof fetch;
}

export interface RunOptions {
  config?: SuiteConfigOverride;
  webhookUrl?: string;
  /** Surface lifecycle/trace events as they appear (delivered via polling). */
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
  /** Poll cadence (ms). */
  pollIntervalMs?: number;
}

// ---- self-contained production (the agentic harness) ------------------------
// produce() runs the full Auto Director loop in-process (understand → plan →
// execute shots → QC → stitch) over an injected transport — no Service API hop.

/** Role of a bible (global, atemporal) asset. */
export type BibleRole = 'style' | 'character' | 'location' | 'prop' | 'brand';

/** A canonical anchor every generative step references so chunks stay consistent. */
export interface BibleEntry {
  id: string;
  role: BibleRole;
  name?: string;
  url: string;
  locked?: boolean;
}

/** What to make a film of. `sources` are optional seed image URLs / data URLs. */
export interface ProduceInput {
  idea: string;
  sources?: string[];
  /** Target length in seconds (preferred). Drives the shot count (~one shot / 5s). */
  targetSeconds?: number;
  /** Rough target runtime in minutes; used when `targetSeconds` is absent. Default 1. */
  targetMinutes?: number;
  /**
   * Global style/character/location/prop/brand anchors. Every generative step also
   * receives its bible references (bounded, style-first) so the look + cast stay
   * consistent across shots — the mechanism that kills cross-shot drift.
   */
  bible?: BibleEntry[];
}

/** Input for the Service-API `autoDirector` run (ProduceInput + headless knobs). */
export interface AutoDirectorInput extends ProduceInput {
  perStepCount?: number;
  explore?: boolean;
  qc?: boolean;
}

/** The VLM's reading of the idea + any sources. */
export interface Brief {
  logline: string;
  genre: string;
  mood: string;
  palette: string;
  subjects: { name: string; description: string }[];
  locations: { name: string; description: string }[];
}

/** One planned production step, mapped to an agent. */
export interface PlanStep {
  id: string;
  agent: AgentId | string;
  title: string;
  intent: string;
  params: Record<string, unknown>;
  /** Ids of earlier steps whose (picked) outputs feed this one. */
  dependsOn: string[];
}

/** An ordered animated clip in the final cut. */
export interface Shot { stepId: string; url: string; prompt?: string }

/** A picked output of any step (image or video). */
export interface ProducedAsset { stepId: string; kind: 'image' | 'video'; url: string; prompt?: string }

export interface ProduceResult {
  brief: Brief;
  /** Full plan with each step's status, outputs and pick. */
  plan: ProductionStep[];
  /** Ordered video shots (the final cut, before/after stitching). */
  shots: Shot[];
  /** Every step's picked output. */
  assets: ProducedAsset[];
  /** Present only when shots were stitched (ffmpeg available / stitch provided). */
  film?: { path?: string; url?: string; shots: number };
}

/** Lifecycle events streamed during a production. */
export type ProductionEvent =
  | { type: 'phase'; phase: 'understanding' | 'planning' | 'executing' | 'stitching' | 'done'; data?: unknown }
  | { type: 'plan'; plan: ProductionStep[] }
  | { type: 'step'; stepId: string; agent: string; index: number; total: number; status: StepStatus; message?: string }
  | { type: 'asset'; stepId: string; kind: 'image' | 'video'; url: string }
  | { type: 'film'; path?: string; url?: string; shots: number }
  | { type: 'warning'; message: string }
  /** Full state snapshot after each mutation — for interactive UIs. */
  | { type: 'state'; state: ProductionState };

/** Stitch capability: ordered shot URLs → a playable file/url. */
export type StitchFn = (shots: string[], opts?: { outPath?: string; name?: string }) => Promise<{ path?: string; url?: string }>;

export interface ProduceOptions {
  /** Defaults to env MODELARK_API_KEY / ARK_API_KEY. */
  apiKey?: string;
  /** ModelArk API base; defaults to env MODELARK_API_BASE_URL. */
  baseUrl?: string;
  config?: SuiteConfigOverride;
  /** Phase 0 creative style exploration. Default false (cheaper, deterministic). */
  explore?: boolean;
  /** Run QC to pick the best of multiple outputs. Default true (no-op when 1 output). */
  qc?: boolean;
  /** Outputs generated per generative step. Default 1. */
  perStepCount?: number;
  /** Override stitching. `false` disables it (returns shots, no film). Default: bundled ffmpeg stitch. */
  stitch?: StitchFn | false;
  /** Where to write the final mp4 (when stitching). */
  outPath?: string;
  onEvent?: (event: ProductionEvent) => void;
  signal?: AbortSignal;
}

// ---- interactive production session -----------------------------------------

export type ProductionMode = 'review' | 'auto';
export type ProductionStatus =
  | 'idle' | 'understanding' | 'planning' | 'review-plan' | 'running' | 'assembling' | 'done' | 'error';
export type StepStatus = 'pending' | 'running' | 'review' | 'approved' | 'skipped' | 'failed';

export interface StepOutput { id: string; url: string; kind: 'image' | 'video'; prompt?: string; label?: string }

/** A plan step plus its live execution state. */
export interface ProductionStep extends PlanStep {
  gated: boolean;
  status: StepStatus;
  outputs: StepOutput[];
  pickedId: string | null;
  qc: unknown;
  error: string | null;
  /** Bible entry ids this step references (resolved to images at run time). */
  bibleRefs?: string[];
  /** Locked steps are never re-touched by regenerate or an auto-run. */
  locked?: boolean;
  /** The user's steering note from the last regenerate (the filter's feedback). */
  feedback?: string;
}

export interface ProductionState {
  status: ProductionStatus;
  brief: Brief | null;
  cursor: number;
  film: { path?: string; url?: string; shots: number } | null;
  error: string | null;
  mode: ProductionMode;
  plan: ProductionStep[];
}

/** Options for createProduction(). `mode` defaults to 'review' (interactive). */
export interface ProductionOptions extends Omit<ProduceOptions, 'apiKey' | 'baseUrl'> {
  mode?: ProductionMode;
}

/** Input to the shared step primitive `runStep`. */
export interface RunStepInput {
  agent: AgentId | string;
  params?: Record<string, unknown>;
  inputUrls?: string[];
  count?: number;
  intent?: string;
  config?: SuiteConfigOverride;
}

/**
 * A stateful, interactive production. Drive it step by step, or call `runAll()` for
 * the autonomous loop. Subscribe with `on()` (the `state` event carries a full
 * snapshot for UIs). The same engine powers `produce()` and the canvas.
 */
export interface Production {
  readonly state: ProductionState;
  on(listener: (event: ProductionEvent) => void): () => void;
  understand(): Promise<Brief>;
  plan(): Promise<ProductionStep[]>;
  replan(): Promise<ProductionStep[]>;
  start(): void;
  runStep(stepId?: string): Promise<ProductionStep | null>;
  pick(stepId: string, outputId: string): void;
  approve(stepId?: string): void;
  /** Regenerate a step, optionally steered by the user's note (the filter's feedback). */
  regenerate(stepId: string, opts?: { note?: string }): Promise<ProductionStep | null>;
  skip(stepId?: string): void;
  editStep(stepId: string, patch: Partial<ProductionStep>): void;
  addStep(agent: AgentId | string, atIndex?: number): string;
  removeStep(stepId: string): void;
  moveStep(stepId: string, dir: number): void;
  toggleGate(stepId: string): void;
  setMode(mode: ProductionMode): void;
  /** Auto-run from the cursor, pausing at the next gated step (canvas "auto" mode). */
  resume(): Promise<void>;
  stitch(): Promise<ProduceResult['film'] | null>;
  /** Fully autonomous: understand → plan → run every step → stitch. */
  runAll(): Promise<ProduceResult>;
  result(): ProduceResult;
}
