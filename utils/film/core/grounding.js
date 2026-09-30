import { parseJson } from './director';

// VISUAL GROUNDING replies (ModelArk): the model marks a region as
// <bbox>x1 y1 x2 y2</bbox> on a 0–999 grid per axis, top-left origin. This turns a
// reply into plain data — box as fractions of the image (0–1) — so code, never the
// model, does the measuring. Expects a JSON list of {what, bbox}; anything that is
// not a well-formed box is dropped rather than guessed at.
const BOX_RE = /<bbox>\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*<\/bbox>/i;
const unit = (v) => Math.min(1, Math.max(0, Number(v) / 1000));

export const parseGrounding = (text) => {
  const list = parseJson(text);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const m = BOX_RE.exec(String(item?.bbox || ''));
    if (!m) return null;
    const [x1, y1, x2, y2] = m.slice(1).map(unit);
    return { what: String(item?.what || item?.category || item?.desc || '').trim(), box: [x1, y1, x2, y2] };
  }).filter(Boolean);
};
