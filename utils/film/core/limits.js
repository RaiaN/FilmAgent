// LIMITS — what a model call can take. Input over a limit is an error that says so; it is
// never cut down to fit. (Cutting would send something the director did not write or pick.)

export const fitText = (text, max, what) => {
  const t = String(text || '');
  if (t.length > max) throw new Error(`${what} is ${t.length.toLocaleString()} characters — this step reads at most ${max.toLocaleString()}. Shorten it, or split it.`);
  return t;
};

export const fitList = (list, max, what) => {
  const l = (list || []).filter(Boolean);
  if (l.length > max) throw new Error(`${l.length} ${what} — this step takes at most ${max}. Remove ${l.length - max}.`);
  return l;
};
