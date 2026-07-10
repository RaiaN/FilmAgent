// The Film pipeline — the EXPLICIT, ordered production plan. One readable list
// (like RECIPES / CAMERA_MOVES): each stage names the agents that serve it, the
// human gate that closes it, and what it produces. This file IS the answer to
// "what order do the agents run in?" — no flow logic buried in components.
//
// The end goal it drives: a VERTICAL SLICE — a 1–3 minute finished film pilot
// produced by walking every stage, judged on five artifacts: the bible, the
// storyboard cards, the shot plan, the stitched film, and the History export.
//
// Pure data + a derivation helper; no React, no network. Stage status is DERIVED
// from what actually exists in the project (same philosophy as the bible
// reconciler) — a stored checklist could lie, the artifacts can't.

export const FILM_PIPELINE = [
  {
    id: 'ideation',
    label: 'Idea',
    agents: ['inspiration'],
    gate: 'none — diverging is cheap',
    produces: 'the premise + (optional) inspiration & mood imagery on the board',
  },
  {
    id: 'storyboard',
    label: 'Brief',
    agents: ['story'],
    gate: 'write the brief, then Storyboard it or drop a SHOT card',
    produces: 'your idea/script held VERBATIM on a Brief card → Cast & World, a storyboard, or a developed cinematic prompt for a SHOT card',
  },
  {
    id: 'casting',
    label: 'Cast & world',
    agents: ['cast', 'characterVariations', 'locationVariations'],
    gate: 'tag the keepers into the bible',
    produces: 'locked cast + places (the real assets the shots reference)',
  },
  {
    id: 'filming',
    label: 'Filming',
    agents: ['animate'],
    gate: 'approve or re-shoot each take',
    produces: 'shots on the timeline, direct from your real assets',
  },
  {
    id: 'finalCut',
    label: 'Final cut',
    agents: [],
    gate: 'watch it',
    produces: 'the stitched film + the decision-history export',
  },
];

const CAST_ROLES = ['character'];
const PLACE_ROLES = ['location'];

// Derive each stage's status from the project's actual artifacts.
// Inputs are substrate-free so this is provable without a browser:
//   idea          — the project idea string
//   bibleEntries  — [{ role }] tagged anchors
//   cutCards      — [{ shotUrl? }] the storyboard/CUT cards on the board
//   filmUrl       — the stitched final cut, if any
//   candidates    — count of untagged board images (ideation output)
export const pipelineStatus = ({ idea = '', storyPrompt = '', bibleEntries = [], cutCards = [], filmUrl = '', candidates = 0 } = {}) => {
  const hasIdea = !!String(idea).trim();
  const hasStory = !!String(storyPrompt).trim();
  const hasCast = bibleEntries.some((e) => CAST_ROLES.includes(e?.role));
  const hasPlace = bibleEntries.some((e) => PLACE_ROLES.includes(e?.role));
  const shot = cutCards.filter((c) => c && c.shotUrl).length;
  const total = cutCards.length;

  const status = {
    ideation: hasIdea ? 'done' : (candidates > 0 ? 'inProgress' : 'todo'),
    // Brief keys off the user's VERBATIM brief text, never SHOT cards or the (opt-in)
    // developed prompt — so skipping Develop or deleting a card never regresses it.
    storyboard: hasStory ? 'done' : 'todo',
    casting: (hasCast && hasPlace) ? 'done' : (bibleEntries.length ? 'inProgress' : 'todo'),
    filming: shot > 0 ? (total > 0 && shot >= total ? 'done' : 'inProgress') : 'todo',
    finalCut: filmUrl ? 'done' : 'todo',
  };
  const note = {
    ideation: hasIdea ? 'idea set' : (candidates ? `${candidates} candidate(s), no idea yet` : 'no idea yet'),
    storyboard: hasStory ? 'brief written' : 'no brief yet',
    casting: [hasCast ? 'cast ✓' : 'no cast', hasPlace ? 'places ✓' : 'no places'].join(' · '),
    filming: total ? `${shot}/${total} shot` : '—',
    finalCut: filmUrl ? 'film ready' : 'not stitched',
  };

  return FILM_PIPELINE.map((stage) => ({
    ...stage,
    status: status[stage.id] || 'todo',
    note: note[stage.id] || '',
  }));
};

// The next stage worth working on (first not-done, in order).
export const nextStage = (statusList) => (statusList || []).find((s) => s.status !== 'done') || null;
