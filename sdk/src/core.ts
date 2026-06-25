// Typed bridge to the pure JS core (utils/film/core/*, utils/film/*).
//
// These modules are the orchestration IP — framework-agnostic, transport-injected,
// already used by the app's canvas. We REUSE them (not duplicate) by importing here;
// tsup inlines them into dist/ so the published SDK is self-contained. `allowJs`
// lets TS resolve them; we cast to precise signatures here so the rest of the SDK
// gets real types and all JS interop lives in exactly one file.

import * as opsJs from '../../utils/film/core/operations.js';
import { runProduction as runProductionJs } from '../../utils/film/core/orchestrator.js';
import { createProduction as createProductionJs, runStep as runStepJs } from '../../utils/film/core/production.js';
import {
  detectGenre as detectGenreJs, castFromIdea as castFromIdeaJs,
  readStoryboard as readStoryboardJs, panelToShot as panelToShotJs,
} from '../../utils/film/core/storyboard.js';
import { createDirectClient as createDirectClientJs } from '../../utils/film/core/directClient.js';
import { getAgentDefaults as getAgentDefaultsJs, getModel as getModelJs } from '../../utils/film/suiteConfig.js';

import type {
  PipelineResult, ProduceInput, ProduceOptions, StitchFn,
  Production, ProductionOptions, RunStepInput, StepOutput,
  BibleEntry, Panel, BlueprintShot, GenreRead, StoryArc,
} from './types';

/**
 * The transport the core operations call. Two implementations exist:
 * direct → ModelArk (createDirectClient), or the app's own Next routes (browser).
 */
export interface Client {
  generateImage(a: { prompt: string; referenceImages?: string[]; size?: string; model?: string }): Promise<{ url: string; prompt: string }>;
  reason(a: { prompt: string; systemPrompt?: string; images?: string[]; video?: string; modelId?: string; reasoningEffort?: string | null }): Promise<{ content: string }>;
  startVideo(a: { content: unknown; model?: string; resolution?: string; ratio?: string; duration?: number | string; generateAudio?: boolean }): Promise<{ taskId: string }>;
  pollVideo(a: { taskId: string; intervalMs?: number; timeoutMs?: number }): Promise<{ videoUrl: string }>;
}

/** Context passed to every core operation. */
export interface Ctx { client: Client; config?: unknown }

type Item = { url: string; prompt?: string; label?: string };
type ImageOp = (input: Record<string, unknown>, ctx: Ctx, onItem?: (i: Item) => void) => Promise<{ created: number; errors: string[] }>;

// ---- per-agent operations ----
export const inspiration = opsJs.inspiration as unknown as ImageOp;
export const characterVariations = opsJs.characterVariations as unknown as ImageOp;
export const locationVariations = opsJs.locationVariations as unknown as ImageOp;
export const animate = opsJs.animate as unknown as
  (input: Record<string, unknown>, ctx: Ctx) => Promise<{ taskId: string; prompt: string }>;

// ---- the orchestration loop (shared core; bundled into the SDK) ----
// Headless = the PIPELINE: cast (provided or generated once) → storyboard →
// direct-to-video → stitch. Nothing invents a shot list outside the storyboard.
export const runProduction = runProductionJs as unknown as
  (input: ProduceInput, transport: { client: Client; stitch?: StitchFn }, opts?: ProduceOptions) => Promise<PipelineResult>;

// Interactive session + the shared step primitive.
export const createProduction = createProductionJs as unknown as
  (input: ProduceInput, transport: { client: Client; stitch?: StitchFn }, opts?: ProductionOptions) => Production;
export const runStep = runStepJs as unknown as
  (input: RunStepInput, ctx: Ctx) => Promise<Array<Omit<StepOutput, 'id'>>>;

// ---- the storyboard builders (plan a blueprint from an idea) ----
// The pipeline's planning stages, exposed so you can build a blueprint yourself
// (e.g. to drive an INTERACTIVE createProduction from an idea). The order is:
// detectGenre? → castFromIdea → readStoryboard → panelToShot. Each takes a Ctx
// ({ client, config }) — get a client from createDirectClient. Frame rendering
// (createStoryboard) is intentionally NOT exposed: it's a UI-review artifact.
export const detectGenre = detectGenreJs as unknown as
  (input: { idea: string; config?: unknown }, ctx: Ctx) => Promise<GenreRead>;
export const castFromIdea = castFromIdeaJs as unknown as
  (input: { idea: string; genre?: string; config?: unknown }, ctx: Ctx,
   hooks?: { onPlan?: (plates: Array<{ role: string; name: string }>) => void; onEntry?: (entry: BibleEntry, i: number) => void }) => Promise<BibleEntry[]>;
export const readStoryboard = readStoryboardJs as unknown as
  (input: { idea: string; genre?: string; targetSeconds?: number; count?: number; bible?: BibleEntry[]; config?: unknown }, ctx: Ctx)
    => Promise<{ anchors: BibleEntry[]; panels: Panel[]; arc: StoryArc | null }>;
export const panelToShot = panelToShotJs as unknown as
  (panel: Panel, anchors?: BibleEntry[], genre?: string) => BlueprintShot;

// ---- config + transport ----
export const getAgentDefaults = getAgentDefaultsJs as unknown as (agentId: string, perCall?: unknown) => Record<string, unknown>;
export const getModel = getModelJs as unknown as (key: string, perCall?: unknown) => string;
export const createDirectClient = createDirectClientJs as unknown as (opts: { apiKey?: string; baseUrl?: string }) => Client;
