// THE SCRIPT'S FORM AND ITS NUMBERED SCENES — code only, no model. Sluglines (INT./EXT. PLACE –
// DAY) make a text a screenplay; each scene's length is counted in eighths of a page
// (1 page ≈ 1 minute of screen time). Pure: the model and the page read it instantly.
const SLUG_RE = /^\s*(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.|EXT\.)\s+(.+?)\s*$/i;
const PAGE_LINES = 54; // a formatted screenplay page
const LINE_CHARS = 58; // characters per formatted line
const SECONDS_PER_EIGHTH = 7.5; // 1 page ≈ 1 minute

export const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

// The slugline's place and time: "TOP FLAT – DAY" → { place: 'TOP FLAT', time: 'DAY' }.
const placeTime = (rest) => {
  const parts = String(rest).split(/\s+[–—-]\s+/);
  return parts.length > 1 ? { place: parts.slice(0, -1).join(' – ').trim(), time: parts[parts.length - 1].trim() } : { place: rest.trim(), time: '' };
};
const eighthsOf = (text) => {
  const lines = String(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.trim().length / LINE_CHARS)), 0);
  return Math.max(1, Math.round((lines / PAGE_LINES) * 8));
};

// Code only: the form of the text and its numbered scenes.
export const parseScript = (script) => {
  const text = String(script || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const scenes = [];
  lines.forEach((line) => {
    const m = SLUG_RE.exec(line);
    if (m) {
      const { place, time } = placeTime(m[2]);
      scenes.push({ n: scenes.length + 1, slug: line.trim(), intExt: m[1].toUpperCase().replace(/\s+/g, ''), place, time, lines: [] });
    } else if (scenes.length) scenes[scenes.length - 1].lines.push(line);
  });
  if (!scenes.length) return { form: words(text) > 150 ? 'treatment' : 'idea', words: words(text), scenes: [] };
  return {
    form: 'screenplay',
    words: words(text),
    scenes: scenes.map(({ lines: body, ...sc }) => {
      const sceneText = body.join('\n').trim();
      const eighths = eighthsOf(`${sc.slug}\n${sceneText}`);
      return { ...sc, text: sceneText, eighths, seconds: Math.round(eighths * SECONDS_PER_EIGHTH) };
    }),
  };
};

// "1 4/8" pages, the way a stripboard writes length.
export const pagesLabel = (eighths) => {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  return [whole ? String(whole) : '', rest ? `${rest}/8` : ''].filter(Boolean).join(' ') || '0';
};

