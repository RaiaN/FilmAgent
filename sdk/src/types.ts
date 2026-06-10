// Public types for the @modelark/film SDK.

export type AgentId =
  | 'inspiration'
  | 'characterVariations'
  | 'locationVariations'
  | 'mixMatch'
  | 'animate'
  | 'promptMuse'
  | 'storyBeats';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Optional per-suite / per-call overrides of the root SuiteConfig. */
export interface SuiteConfigOverride {
  models?: Partial<Record<'seedream' | 'seedance' | 'reasoner', string>>;
  prompts?: Record<string, string>;
  defaults?: Record<string, Record<string, unknown>>;
  runtime?: { pollIntervalMs?: number; timeoutMs?: number; defaultImageSize?: string };
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
  | AnimateInput | PromptMuseInput | StoryBeatsInput;

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
