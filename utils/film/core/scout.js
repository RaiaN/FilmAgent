import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { animate } from './operations';
import { parseGrounding } from './grounding';

// TECH SCOUT: an EMPTY-location survey rendered from one master plate (locked as the
// first frame), then background frames pulled from it for SHOT cards. Only the camera
// paths that held the space together in testing are offered: a turn in place (reveals
// the room; the loop closes on the plate) and a walk-in (forward move with parallax).
export const SCOUT_PATHS = {
  turn: { label: 'Turn in place', seconds: 12, template: 'scout.path.turn' },
  walk: { label: 'Walk-in', seconds: 10, template: 'scout.path.walk' },
};

// Kicks off one survey render; the caller polls. A locked first frame sets the aspect,
// so no ratio is sent. The survey is picture only.
export const startSurvey = async ({ plateUrl, path, modelKey, resolution = '1080p', config } = {}, ctx) => {
  const p = SCOUT_PATHS[path];
  if (!p) throw new Error(`Unknown survey path "${path}"`);
  if (!plateUrl) throw new Error('Tech Scout needs a location plate');
  const motion = renderTemplate('scout.survey', { path: renderTemplate(p.template) });
  return animate({
    firstFrameUrl: plateUrl, motion, duration: p.seconds, resolution, ratio: null,
    generateAudio: false, modelKey, config,
  }, ctx);
};

// Evenly spaced frame times across the survey, first at 0 s, the last just inside the end.
export const surveyFrameTimes = (seconds, count) => {
  const n = Math.max(2, Math.round(Number(count) || 6));
  const end = Math.max(0.1, Number(seconds) - 0.05);
  return Array.from({ length: n }, (_, i) => Number(((end * i) / (n - 1)).toFixed(2)));
};

// Is this background frame really empty? The model points (grounding), code decides:
// any box returned is a person or animal the frame should not have.
export const checkEmpty = async ({ imageUrl, config } = {}, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('scout.emptyCheck'),
    images: [imageUrl],
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  return parseGrounding(content);
};
