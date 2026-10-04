import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconLoading, IconSend } from '@arco-design/web-react/icon';
import { createBrowserClient } from '../utils/film/core/client';
import { makeThumbnail } from '../utils/film/canvasModel';
import { AssetBoard, BeatSheet, Empty, LINE, LookPanel, SCRIPT_FONT, ShotBoard, ShotDrawer, platesFor } from './storyroom/panels';
import { BLOCKS, BLOCK_CAP, SPINE_CAP, SCORE_KEYS, architectBlueprint, blueprintProblems, blueprintScript, critiqueBlueprint, ideaText, planShots, probeOriginality, renderShotPrompt, boundAssets, fixOptions, flaggedFixes, scoutIdeas, storyFacts, writeShotBodies, castDesignOf, describeLook, lookPresets, detectScenes, sceneNumbers, scenesFound, linkOf, reopenShot, blockScene, blockingPlan, cardsOf, cardAsShot, secondsOfCard, renderCardPrompt, writeCard, writeCards } from '../utils/film/core/story';
import { previzSchematic } from '../utils/film/core/previz';
import { REASONER_OPTIONS, getRuntime, reasonerSlotOf } from '../utils/film/suiteConfig';

const { Text } = Typography;

// STORY ROOM — a production binder in five departments:
//   Story (idea → blueprint → Critic/Reviser) · Look (one style sentence) · Beat sheet (what
//   the viewer must see or hear) · Assets (the casting board every shot binds to) · Shots
//   (Seedance 2.5 prompts rendered from the board + the Look) → the Film Agent board.

const STORAGE_KEY = 'story-room';
const BLOCK_LABEL = {
  protagonist: 'Protagonist', flaw: 'Flaw', internal_need: 'Internal need', inciting_incident: 'Inciting incident',
  external_want: 'External want', antagonist: 'Antagonist', journey: 'Journey', crisis: 'Crisis', climax: 'Climax', resolution: 'Resolution',
};
const ITEM_LABEL = {
  q1: 'Filmable want', q2: 'Want forces need', q3: 'Antagonist strength', q4: 'Escalating journey', q5: 'Crisis is a real choice',
  q6: 'Protagonist causes climax', q7: 'Resolution shows change', originality: 'Originality', specificity: 'Place is load-bearing',
};
const ROLE_LABEL = {
  look: 'Reading the references\' look',
  scout: 'Scout is finding ideas', probe: 'Checking originality', architect: 'Architect is building the blueprint', critic: 'Critic is stress-testing', options: 'Writing 3 fix options and judging them blind',
  facts: 'Listing what the viewer must see and hear', plan: 'Planning the assets and shots', shots: 'Writing the Seedance 2.5 shots', scenes: 'Finding the scene changes', reopen: 'Re-opening the shot from the take', block: 'Blocking the scenes', draw: 'Drawing the blocking',
};
const SCORE_COLOR = ['#cb2634', '#d25f00', '#00a870'];

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const load = () => { try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; } };

const ScorePip = ({ score }) => (
  <span style={{ display: 'inline-grid', placeItems: 'center', width: 20, height: 20, borderRadius: '50%', border: `1.5px solid ${SCORE_COLOR[score]}`, color: SCORE_COLOR[score], fontSize: 11, fontWeight: 700, flex: '0 0 auto' }}>{score}</span>
);

const OriginalityTag = ({ probe }) => {
  if (!probe) return null;
  if (!probe.ok) return <Tag size="small">Originality unchecked</Tag>;
  const tip = [probe.sharedPremise && `Shared premise: ${probe.sharedPremise}`, probe.note].filter(Boolean).join('\n');
  return (
    <Tooltip content={<span style={{ whiteSpace: 'pre-wrap' }}>{tip || 'No close match named.'}</span>}>
      {probe.fresh
        ? <Tag size="small" color="green">Fresh</Tag>
        : <Tag size="small" color="orange">Echoes {probe.closestWork || 'a known work'}</Tag>}
    </Tooltip>
  );
};

const StoryRoomPlayground = ({ onSendToFilm, onOpenOnBoard, onSync, onCircleTake, focusShot, boardPlates = [], boardShots = [], projectStory = null, projectTitle = '', onStoryChange }) => {
  const ctx = useMemo(() => ({ client: createBrowserClient() }), []);
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState(6);
  const [ideas, setIdeas] = useState([]); // [{ ...idea, probe }]
  const [source, setSource] = useState(null); // the idea the blueprint was built from: { text, probe }
  const [blueprint, setBlueprint] = useState(null);
  const [critique, setCritique] = useState(null);
  const [revised, setRevised] = useState([]); // blocks the last accepted fix rewrote
  const [fixRoot, setFixRoot] = useState(null); // the flagged block picked to fix
  const [fixSet, setFixSet] = useState(null); // { root, note, options: [], verdict }
  const [facts, setFacts] = useState([]); // the visual beat sheet: [{ id, block, kind, fact }]
  const [assets, setAssets] = useState([]); // the roster: [{ key, kind, name, look }]
  const [shots, setShots] = useState([]); // [{ title, location, assets, shows, moment, body }]
  const [look, setLook] = useState(''); // the story's one visual style sentence
  const [lookImages, setLookImages] = useState([]); // style references (downscaled data URLs)
  const [tab, setTab] = useState('story');
  const [sendId, setSendId] = useState(''); // the last Send — its board cards report back here
  const [openShot, setOpenShot] = useState(null); // the shot open in the drawer
  const [busy, setBusy] = useState(null); // { role, at }
  const [elapsed, setElapsed] = useState(0);
  const [linked, setLinked] = useState(null); // the Film Agent project this story is saved in: { projectId }

  // One story per Film Agent project: it arrives with the project (projectStory) and is
  // written back into it (onStoryChange), so it rides the project's cloud autosave.
  const applyState = (st = {}) => {
    setIdea(typeof st.idea === 'string' ? st.idea : '');
    setIdeas(Array.isArray(st.ideas) ? st.ideas : []);
    setSource(st.source || null);
    setBlueprint(st.blueprint || null);
    setCritique(st.critique || null);
    setRevised(Array.isArray(st.revised) ? st.revised : []);
    setFacts(Array.isArray(st.facts) ? st.facts : []);
    setAssets(Array.isArray(st.assets) ? st.assets : []);
    setLook(typeof st.look === 'string' ? st.look : '');
    setLookImages(Array.isArray(st.lookImages) ? st.lookImages : (typeof st.lookImage === 'string' && st.lookImage ? [st.lookImage] : []));
    setTab(typeof st.tab === 'string' ? st.tab : 'story');
    setSendId(typeof st.sendId === 'string' ? st.sendId : '');
    setShots(Array.isArray(st.shots) ? st.shots.map((x) => ({ ...x, assets: x.assets || [], shows: x.shows || [], body: x.body ?? x.prompt ?? '' })) : []);
    setFixSet(null);
    setFixRoot(null);
    setOpenShot(null);
  };
  useEffect(() => {
    if (!projectStory?.projectId) return;
    const pid = projectStory.projectId;
    let data = projectStory.data;
    // The project's own copy wins; a local cache only fills in for a project that has none.
    if (!data) { try { data = JSON.parse(window.localStorage.getItem(`${STORAGE_KEY}:${pid}`) || 'null'); } catch { data = null; } }
    applyState(data || {});
    setLinked({ projectId: pid });
    // A story saved before stories lived in projects waits to be brought in — the
    // filmmaker picks the project, it is never adopted by whichever one opened first.
    const legacy = load();
    setOrphan(!data && (legacy.blueprint || legacy.idea) && !legacy.adoptedBy ? legacy : null);
  }, [projectStory?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [orphan, setOrphan] = useState(null);
  const adoptOrphan = () => {
    if (!orphan || !linked) return;
    applyState(orphan);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ adoptedBy: linked.projectId })); } catch { /* noop */ }
    setOrphan(null);
    Message.success('The story is now saved in this Film Agent project.');
  };

  const snapshot = useMemo(() => ({ idea, ideas, source, blueprint, critique, revised, facts, assets, shots, look, lookImages, tab, sendId }),
    [idea, ideas, source, blueprint, critique, revised, facts, assets, shots, look, lookImages, tab, sendId]);
  const hasStory = !!(idea.trim() || blueprint || ideas.length || look.trim() || lookImages.length);
  useEffect(() => {
    if (!linked || !hasStory) return undefined;
    const t = setTimeout(() => {
      if (onStoryChange) onStoryChange(linked.projectId, snapshot);
      try { window.localStorage.setItem(`${STORAGE_KEY}:${linked.projectId}`, JSON.stringify(snapshot)); } catch { /* quota — the project copy stands */ }
    }, 800);
    return () => clearTimeout(t);
  }, [snapshot, linked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busy) return undefined;
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - busy.at) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async (role, fn) => {
    if (busy) return null;
    setBusy({ role, at: Date.now() });
    try { return await fn(); } catch (err) { Message.error({ content: err.message || String(err), duration: 8000 }); return null; } finally { setBusy(null); }
  };

  // The planner + effort live in the browser's config — read after mount (and when the tab
  // is revisited), never during the server render, or hydration sees two different texts.
  const [planner, setPlanner] = useState(null);
  useEffect(() => {
    const read = () => setPlanner({ label: (REASONER_OPTIONS.find((o) => o.key === reasonerSlotOf()) || {}).label || 'planner', effort: getRuntime().reasoningEffort });
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);
  const problems = blueprint ? blueprintProblems(blueprint) : [];

  const scout = () => run('scout', async () => {
    const found = await scoutIdeas({ direction: idea, count }, ctx);
    setIdeas(found.map((x) => ({ ...x, probe: null })));
    setBusy({ role: 'probe', at: Date.now() });
    const probes = await probeOriginality({ ideas: found }, ctx).catch(() => []);
    setIdeas(found.map((x, i) => ({ ...x, probe: probes[i] || null })));
  });

  // Develop: the Architect (and, for your own words, the originality probe in parallel),
  // then the Critic, so the flagged blocks are on screen when the blueprint lands.
  const develop = (from) => run('architect', async () => {
    const text = ideaText(from).trim();
    if (!text) { Message.warning('Write an idea first, or Scout some.'); return; }
    const probeP = from.probe !== undefined ? Promise.resolve(from.probe) : probeOriginality({ ideas: [text] }, ctx).then((p) => p[0] || null).catch(() => null);
    const { blueprint: bp, problems: left } = await architectBlueprint({ idea: from }, ctx);
    if (!bp.title && from.title) bp.title = from.title;
    setSource({ text, title: from.title || '', probe: await probeP });
    setBlueprint(bp);
    setCritique(null);
    setRevised([]);
    setFacts([]);
    setAssets([]);
    setShots([]);
    if (left.length) Message.warning(`The blueprint still breaks ${left.length} check${left.length === 1 ? '' : 's'} — see below.`);
    setBusy({ role: 'critic', at: Date.now() });
    setCritique(await critiqueBlueprint({ blueprint: bp }, ctx));
  });

  const critiqueNow = () => run('critic', async () => { setCritique(await critiqueBlueprint({ blueprint }, ctx)); });

  // Options, not patches: the picked problem → 3 alternative cascades from its root block
  // (written in parallel) → a blind judge ranks them against the current version. The
  // filmmaker picks; nothing changes until they do.
  const flagged = flaggedFixes(critique);
  const activeFix = flagged.find((f) => f.root === fixRoot) || flagged[0] || null;
  const writeOptions = () => activeFix && run('options', async () => {
    setFixSet({ root: activeFix.root, note: activeFix.note, options: [], verdict: null });
    const out = await fixOptions({
      blueprint, root: activeFix.root, note: activeFix.note,
      onOption: (i, o) => setFixSet((cur) => (cur && cur.root === activeFix.root ? { ...cur, options: [...cur.options.filter((x) => x.index !== i), { ...o, index: i }].sort((a, b) => a.index - b.index) } : cur)),
    }, ctx);
    setFixSet({ root: activeFix.root, note: activeFix.note, options: out.options, verdict: out.verdict });
  });
  const useOption = (o) => {
    setBlueprint({ ...o.blueprint, title: blueprint.title });
    setRevised(o.changed);
    // The fixed root and every re-derived block below it no longer carry the old notes.
    const cleared = BLOCKS.slice(BLOCKS.indexOf(fixSet.root));
    setCritique((c) => (c ? { ...c, fix: Object.fromEntries(Object.entries(c.fix || {}).filter(([k]) => !cleared.includes(k))), stale: true } : c));
    setFixSet(null);
    setFixRoot(null);
  };

  const setBlock = (k, v) => {
    setBlueprint((b) => ({ ...b, [k]: k === 'journey' ? String(v).split('\n') : v }));
  };
  const cleanJourney = () => setBlueprint((b) => (b ? { ...b, journey: (b.journey || []).map((x) => x.trim()).filter(Boolean) } : b));

  // Write shots: the beat sheet → the plan (asset roster + shots, each binding its assets
  // and facts) → the scenes → each scene blocked → every CARD written: a scene (or a chunk
  // of one) as one generation, one line per shot. Prompts are RENDERED from the roster.
  const writeAllShots = () => run('facts', async () => {
    const f = await storyFacts({ blueprint }, ctx);
    setFacts(f);
    setTab('beats');
    setAssets([]);
    setShots([]);
    setBusy({ role: 'plan', at: Date.now() });
    const plan = await planShots({ blueprint, facts: f }, ctx);
    setAssets(plan.assets);
    setShots(plan.shots);
    setTab('shots');
    setBusy({ role: 'scenes', at: Date.now() });
    let scened = await detectScenes({ shots: plan.shots, assets: plan.assets }, ctx);
    setShots(scened);
    setBusy({ role: 'block', at: Date.now() });
    scened = await blockAll(scened, plan.assets);
    setShots(scened);
    setBusy({ role: 'shots', at: Date.now() });
    const w = await writeCards({ blueprint, facts: f, assets: plan.assets, shots: scened, onCard: landCard }, ctx);
    setShots(w.shots);
    if (w.failed.length) Message.error({ content: w.failed.join(' · '), duration: 10000 });
  });
  const landCard = (rows) => setShots((list) => list.map((x, i) => { const r = rows.find((y) => y.i === i); return r ? { ...x, line: r.line, seconds: r.seconds } : x; }));
  // Scenes: where place or time changes (a shot either continues the shot before it or
  // opens a new scene).
  const runScenes = () => run('scenes', async () => { setShots(await detectScenes({ shots, assets }, ctx)); });
  // BLOCKING — one sheet per scene, on the shot that opens it (marks · paths · axis).
  const sceneStarts = (list) => { const nums = sceneNumbers(list); return list.map((x, i) => i).filter((i) => i === 0 || nums[i] !== nums[i - 1]); };
  const blockAll = async (list, roster) => {
    const starts = sceneStarts(list);
    const sheets = await Promise.all(starts.map((start) => blockScene({ shots: list, start, assets: roster }, ctx)));
    return list.map((x, i) => (starts.includes(i) ? { ...x, blocking: sheets[starts.indexOf(i)] } : x));
  };
  const blockOne = (start) => run('block', async () => {
    const sheet = await blockScene({ shots, start, assets }, ctx);
    setShots((list) => list.map((x, i) => (i === start ? { ...x, blocking: sheet } : x)));
  });
  const setBlocking = (start, sheet) => setShots((list) => list.map((x, i) => (i === start ? { ...x, blocking: sheet } : x)));
  // The blocking drawn as a top-down schematic (the Previz floor plan): marks, paths, axis.
  const drawBlocking = (start) => run('draw', async () => {
    const sheet = String(shots[start].blocking || '').trim();
    if (!sheet) throw new Error('Block the scene first.');
    const { url, cacheUrl } = await previzSchematic({ plan: blockingPlan(sheet, assets) }, ctx);
    setShots((list) => list.map((x, i) => (i === start ? { ...x, blockingSchematic: { url, cacheUrl: cacheUrl || null, sheet } } : x)));
  });
  const checkBlocked = () => {
    if (!scenesFound(shots)) throw new Error('Find the scenes first (Scenes ↻).');
    const unblocked = sceneStarts(shots).filter((i) => !String(shots[i].blocking || '').trim());
    if (unblocked.length) throw new Error(`Block ${unblocked.length === 1 ? 'the scene' : 'the scenes'} opening at SH ${unblocked.map((i) => i + 1).join(', SH ')} first — every card is written against its scene's blocking.`);
  };
  // Write every card again — same shots, scenes and blocking. Replaces hand edits.
  const rewriteCards = () => run('shots', async () => {
    checkBlocked();
    const w = await writeCards({ blueprint, facts, assets, shots: shots.map(({ line, seconds, openedFrom, ...x }) => x), onCard: landCard }, ctx);
    setShots(w.shots);
    if (w.failed.length) Message.error({ content: w.failed.join(' · '), duration: 10000 });
  });
  // Write ONE card again (the card it continues must be written).
  const rewriteCard = (start) => run('shots', async () => {
    if (!scenesFound(shots)) throw new Error('Find the scenes first (Scenes ↻).');
    const card = cardsOf(shots).find((c) => c.start === start);
    landCard(await writeCard({ blueprint, facts, assets, shots, card }, ctx));
  });
  const scenes = sceneNumbers(shots);
  const cards = cardsOf(shots);
  // A shot either continues the shot before it or opens a new scene — set by the scene
  // pass, or by you.
  const setOpensScene = (i, on) => setShots((list) => list.map((x, j) => {
    if (j !== i || i === 0) return x;
    const { newScene, sceneUser, ...rest } = x;
    return { ...rest, link: { from: on ? null : i - 1, user: true }, ...(on ? { sceneReason: 'Set by you.', newCard: false } : {}) };
  }));
  // Inside a scene, a shot can start the next card: the scene is too long for one generation.
  const setNewCard = (i, on) => setShots((list) => list.map((x, j) => (j === i ? { ...x, newCard: !!on } : x)));
  const setShotField = (i, field, v) => setShots((list) => list.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  const setAsset = (key, field, v) => setAssets((list) => list.map((a) => (a.key === key ? { ...a, [field]: v } : a)));
  const toggleBinding = (i, key) => setShots((list) => list.map((x, j) => (j === i ? { ...x, assets: x.assets.includes(key) ? x.assets.filter((k) => k !== key) : [...x.assets, key] } : x)));
  const shotsOfFact = (id) => shots.map((x, i) => (x.shows.includes(id) ? i + 1 : 0)).filter(Boolean);
  const usage = (key) => shots.filter((x) => x.location === key || x.assets.includes(key)).length;

  // Reference images: the board plates of the bound assets (characters, props, then the
  // location — boundAssets' order), one per asset, numbered @Image1..N.
  const shotRefs = (x) => {
    const list = [];
    const numbers = {};
    boundAssets(x, assets).forEach((a) => {
      const p = platesFor(a, boardPlates).main;
      if (!p?.url || !p.nodeId || list.some((q) => q.nodeId === p.nodeId)) return;
      list.push({ ...p, asset: a.name });
      numbers[a.key] = list.length;
    });
    return { list, numbers };
  };
  const cardRefs = (card) => shotRefs(cardAsShot(shots, card));
  const cardPrompt = (card) => renderCardPrompt({ shots, card, assets, look, refs: cardRefs(card).numbers });
  // A card's board card: stamped with this story's board key and the card's first shot.
  const boardCardOf = (card) => boardShots.find((c) => sendId && c.sendId === sendId && c.card && c.index === card.start) || null;
  // THE STORY ROOM OWNS ITS CARDS: every card on the board gets its title, prompt, plates,
  // length and (for a card that continues the one before it) the hand-off, whenever they
  // change here (a beat after the last edit).
  const syncSent = useRef('');
  useEffect(() => {
    if (!onSync) return undefined;
    const t = setTimeout(() => {
      const out = [];
      cards.forEach((card) => {
        const c = boardCardOf(card);
        if (!c || card.idx.some((i) => !String(shots[i].line || '').trim())) return;
        const before = card.opensScene ? null : cards.find((b) => b.end === card.start - 1);
        const src = before ? boardCardOf(before) : null;
        out.push({
          cardId: c.cardId, title: cardTitle(card),
          prompt: cardPrompt(card), refNodeIds: cardRefs(card).list.map((p) => p.nodeId),
          durationSec: secondsOfCard(shots, card),
          from: src ? src.cardId : null, mode: 'open', text: '',
        });
      });
      const key = JSON.stringify(out);
      if (key === syncSent.current) return;
      syncSent.current = key;
      onSync(out);
    }, 400);
    return () => clearTimeout(t);
  }, [shots, assets, look, boardPlates, boardShots, sendId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardTitle = (card) => `Scene ${card.scene} · SH ${card.start + 1}${card.end > card.start ? `–${card.end + 1}` : ''}`;
  // SYNC TO BOARD — a board card for every card that has none yet (the same card keeps
  // its board card for good); the sync above then writes it. A story without shots lands
  // as a Storyboard card.
  const missingCards = cards.filter((c) => !boardCardOf(c)).length;
  const syncToBoard = () => {
    if (!onSendToFilm) return;
    const title = blueprint.title || source?.title || '';
    if (!shots.length) { onSendToFilm({ script: blueprintScript(blueprint), title }); return; }
    const id = sendId || `story-${Date.now().toString(36)}`;
    if (!sendId) setSendId(id);
    const out = cards.filter((c) => !boardCardOf(c)).map((c) => ({ index: c.start, title: cardTitle(c) }));
    if (out.length) onSendToFilm({ sendId: id, cards: out, title });
  };
  // RE-OPEN FROM THE TAKE: a card that continues the one before it opens from that card's
  // circled take's last frame — rewrite only its first line to start from it.
  const needsReopen = (card) => {
    const frame = !card.opensScene ? boardCardOf(card)?.carried?.frameUrl : '';
    return !!frame && shots[card.start].openedFrom?.frame !== frame;
  };
  const reopen = (card) => run('reopen', async () => {
    const frame = boardCardOf(card)?.carried?.frameUrl;
    if (!frame) throw new Error('This card carries no frame yet — circle a take of the card before it.');
    const before = cards.find((b) => b.end === card.start - 1);
    const first = shots[card.start];
    const asShot = { ...first, ...cardAsShot(shots, card), body: first.line };
    const fromShot = { ...cardAsShot(shots, before), body: '' };
    const plates = boundAssets({ ...asShot, assets: [...new Set([...asShot.assets, ...fromShot.assets])] }, assets)
      .map((a) => ({ key: a.key, url: platesFor(a, boardPlates).main?.url })).filter((p) => p.url);
    const line = await reopenShot({ shot: asShot, assets, frameUrl: frame, mode: 'open', plates, fromShot }, ctx);
    setShots((list) => list.map((x, j) => (j === card.start ? { ...x, line, openedFrom: { frame, body: line } } : x)));
  });
  // A board card asked to be edited here: open its card's first shot.
  const focusSeen = useRef(null);
  useEffect(() => {
    if (!focusShot?.nonce || focusShot.nonce === focusSeen.current) return;
    focusSeen.current = focusShot.nonce;
    const c = boardShots.find((b) => b.cardId === focusShot.cardId && b.sendId === sendId && b.card);
    if (!c) { Message.error('That card belongs to a different story than the one open here.'); return; }
    setTab('shots');
    setOpenShot(c.index);
  }, [focusShot]); // eslint-disable-line react-hooks/exhaustive-deps
  // Look: a preset fills the sentence; references are read by the planner into one.
  const presets = lookPresets();
  const addLookImages = async (files) => {
    const read = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    // Checked into the media store, so the project keeps a URL, not a data blob.
    const checkIn = async (dataUrl) => {
      try {
        const r = await fetch('/api/film/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: dataUrl }) });
        const j = await r.json();
        return r.ok && j.url ? j.url : dataUrl;
      } catch { return dataUrl; }
    };
    const imgs = await Promise.all(files.map(async (f) => { const raw = await read(f); return checkIn(await makeThumbnail(raw, 1024).catch(() => raw)); }));
    setLookImages((list) => [...list, ...imgs].slice(0, 6));
  };
  const readLook = () => run('look', async () => { setLook(await describeLook({ images: lookImages, notes: look }, ctx)); });

  const sendAssets = () => {
    if (onSendToFilm && assets.length) onSendToFilm({ cast: castDesignOf(assets), style: look, title: blueprint.title || source?.title || '' });
  };

  const box = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 };
  const capOf = (k) => (k === 'spine' ? SPINE_CAP : BLOCK_CAP);
  const countTag = (k, v) => {
    const n = k === 'journey' ? Math.max(0, ...(v || []).map(words)) : words(v);
    const over = n > capOf(k);
    return <Text style={{ fontSize: 11, color: over ? '#cb2634' : '#86909c', fontVariantNumeric: 'tabular-nums' }}>{k === 'journey' ? `longest ${n}/${capOf(k)}` : `${n}/${capOf(k)}`}</Text>;
  };

  const TABS = [
    { id: 'story', label: 'Story', count: null },
    { id: 'look', label: 'Look', count: look ? '●' : null },
    { id: 'beats', label: 'Beat sheet', count: facts.length || null },
    { id: 'assets', label: 'Assets', count: assets.length || null },
    { id: 'shots', label: 'Shots', count: shots.length || null },
  ];
  const canWrite = !!blueprint && !busy && !problems.length;

  const storyPanel = (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...box, display: 'grid', gap: 10 }}>
        <Input.TextArea
          id="story-room-idea"
          value={idea}
          onChange={setIdea}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder="Your idea in your own words: a line, a character, a memory, a what-if. Or a direction for the Scout (a place, a world, a theme)."
          style={{ fontSize: 14 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" disabled={!!busy || !idea.trim()} onClick={() => develop(idea)}>Develop this idea</Button>
          <Button disabled={!!busy} onClick={scout}>Scout ideas</Button>
          <InputNumber size="small" min={2} max={10} value={count} onChange={(v) => setCount(v || 6)} style={{ width: 72 }} aria-label="How many ideas to scout" />
        </div>
      </div>

      {ideas.length > 0 && (
        <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
          <div style={{ display: 'flex', gap: 12, width: 'max-content' }}>
            {ideas.map((x, i) => (
              <div key={`${x.title}-${i}`} style={{ ...box, width: 300, padding: 14, display: 'grid', gap: 6, alignContent: 'start', borderColor: source?.title === x.title ? '#165dff' : LINE }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ fontWeight: 600, flex: 1 }}>{x.title}</Text>
                  <OriginalityTag probe={x.probe} />
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>{x.place_and_culture}</Text>
                <Text style={{ fontSize: 13 }}>{x.logline}</Text>
                {x.assignment && <Text type="secondary" style={{ fontSize: 11 }}>{[x.assignment.register, x.assignment.situation].filter(Boolean).join(' · ')}</Text>}
                <div><Button size="small" disabled={!!busy} onClick={() => develop(x)}>Develop</Button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {blueprint && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ ...box, display: 'grid', gap: 6, background: '#fcfcfa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#86909c' }}>SPINE</Text>
              <span style={{ flex: 1 }} />
              {countTag('spine', blueprint.spine)}
            </div>
            <Input.TextArea id="story-room-spine" value={blueprint.spine} onChange={(v) => setBlock('spine', v)} autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontFamily: SCRIPT_FONT, fontSize: 14, lineHeight: 1.6, background: 'transparent', border: 'none', padding: 0 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {critique && <Tag color={critique.stale ? 'gray' : critique.total >= 14 ? 'green' : critique.total >= 10 ? 'orange' : 'red'}>Critic {critique.total}/{critique.max}{critique.stale ? ' · before your fix' : ''}</Tag>}
            <Button size="small" disabled={!!busy} onClick={critiqueNow}>{critique ? 'Critique again' : 'Critique'}</Button>
            {problems.length > 0 && <Text style={{ fontSize: 12, color: '#cb2634' }}>Checks failing: {problems.join(' · ')}</Text>}
          </div>

          {flagged.length > 0 && (
            <div style={{ ...box, display: 'grid', gap: 12, borderColor: '#ffcf8b', background: '#fffcf7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#d25f00' }}>EDITOR'S NOTES</Text>
                {flagged.map((f) => (
                  <Tag key={f.root} checkable checked={activeFix?.root === f.root} onCheck={() => { setFixRoot(f.root); if (fixSet?.root !== f.root) setFixSet(null); }}>{BLOCK_LABEL[f.root]}</Tag>
                ))}
                <span style={{ flex: 1 }} />
                <Button size="small" type="primary" disabled={!!busy || !activeFix} onClick={writeOptions}>3 options to fix {BLOCK_LABEL[activeFix?.root] || ''}</Button>
              </div>
              {activeFix && <Text style={{ fontSize: 13 }}>{activeFix.note}</Text>}
              {activeFix && <Text type="secondary" style={{ fontSize: 12 }}>Each option rewrites {BLOCK_LABEL[activeFix.root]} and re-derives every block after it, so the story still holds together. A blind judge ranks them against your current version; nothing changes until you pick one.</Text>}

              {fixSet && fixSet.root === activeFix?.root && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {fixSet.verdict && fixSet.verdict.best === 'current' && (
                    <Text style={{ fontSize: 12, color: '#4e5969' }}><b>The judge prefers your current version.</b> {fixSet.verdict.reasons?.current || ''}</Text>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                    {[0, 1, 2].map((i) => {
                      const o = fixSet.options.find((x) => x.index === i);
                      const rank = o && fixSet.verdict ? fixSet.verdict.ranking.indexOf(fixSet.options.indexOf(o)) : -1;
                      const pick = o && fixSet.verdict && fixSet.verdict.best === fixSet.options.indexOf(o);
                      const why = o && fixSet.verdict ? fixSet.verdict.reasons?.[fixSet.options.indexOf(o)] : '';
                      return (
                        <div key={i} style={{ background: '#fff', border: `1.5px solid ${pick ? '#165dff' : LINE}`, borderRadius: 10, padding: 12, display: 'grid', gap: 8, alignContent: 'start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontSize: 12, fontWeight: 700 }}>Option {String.fromCharCode(65 + i)}</Text>
                            {pick && <Tag size="small" color="arcoblue">Judge's pick</Tag>}
                            {!pick && rank > 0 && <Text type="secondary" style={{ fontSize: 11 }}>#{rank + 1}</Text>}
                            <span style={{ flex: 1 }} />
                            {o && <Button size="mini" type={pick ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => useOption(o)}>Use this</Button>}
                          </div>
                          {!o
                            ? <Text type="secondary" style={{ fontSize: 12 }}>{busy ? 'Writing…' : 'No option'}</Text>
                            : (
                              <>
                                <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>{o.approach}</Text>
                                {why && <Text style={{ fontSize: 12, color: '#165dff' }}>{why}</Text>}
                                {o.changed.filter((k) => k !== 'spine').map((k) => (
                                  <div key={k} style={{ display: 'grid', gap: 2, borderLeft: '2px solid #165dff', paddingLeft: 8 }}>
                                    <Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#86909c' }}>{BLOCK_LABEL[k]}</Text>
                                    <Text style={{ fontSize: 12, lineHeight: 1.5 }}>{Array.isArray(o.blueprint[k]) ? o.blueprint[k].map((x, j) => `${j + 1}. ${x}`).join('  ') : o.blueprint[k]}</Text>
                                  </div>
                                ))}
                              </>
                            )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {BLOCKS.map((k) => {
              const editor = critique?.fix?.[k];
              const v = blueprint[k];
              return (
                <div key={k} style={{ ...box, padding: 12, display: 'grid', gap: 4, alignContent: 'start', minWidth: 0, borderColor: editor ? '#ffcf8b' : LINE }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#4e5969' }}>{BLOCK_LABEL[k]}</Text>
                    {revised.includes(k) && <Tag size="small" color="arcoblue">revised</Tag>}
                    <span style={{ flex: 1 }} />
                    {countTag(k, v)}
                  </div>
                  <Input.TextArea
                    id={`story-room-${k}`}
                    value={k === 'journey' ? (v || []).join('\n') : v}
                    onChange={(val) => setBlock(k, val)}
                    onBlur={k === 'journey' ? cleanJourney : undefined}
                    autoSize={{ minRows: k === 'journey' ? 4 : 2, maxRows: 10 }}
                    placeholder={k === 'journey' ? 'One obstacle per line, 3–5, each costlier than the last' : ''}
                    style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 13, lineHeight: 1.55 }}
                  />
                  {editor && <Text style={{ fontSize: 12, color: '#d25f00' }}>Editor: {editor}</Text>}
                </div>
              );
            })}
          </div>

          {critique && (
            <details style={{ ...box }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#165dff' }}>Stress test · {critique.total}/{critique.max}</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {SCORE_KEYS.map((k) => {
                  const it = critique.items[k];
                  return (
                    <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                      <ScorePip score={it.score} />
                      <span style={{ minWidth: 0 }}>
                        <b>{ITEM_LABEL[k]}.</b> {it.objection}
                        {k === 'originality' && it.closestWork ? <Text type="secondary" style={{ fontSize: 12 }}> Closest: {it.closestWork}{it.sharedPremise ? ` (${it.sharedPremise})` : ''}</Text> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );

  const needsBlueprint = <Empty title="No story yet" hint="Develop an idea on the Story tab first — the beat sheet, assets and shots all grow from its blueprint." action={<Button onClick={() => setTab('story')}>Go to Story</Button>} />;
  const needsShots = (what) => <Empty title={`No ${what} yet`} hint="Write shots turns the blueprint into a visual beat sheet, a casting board of characters, locations and props, and one Seedance 2.5 shot per moment." action={<Button type="primary" disabled={!canWrite} onClick={writeAllShots}>Write shots</Button>} />;

  const panel = {
    story: storyPanel,
    look: <LookPanel look={look} setLook={setLook} presets={presets} images={lookImages} addImages={addLookImages} removeImage={(i) => setLookImages((l) => l.filter((_, j) => j !== i))} readImages={readLook} busy={!!busy} />,
    beats: !blueprint ? needsBlueprint : facts.length ? <BeatSheet facts={facts} shotsOfFact={shotsOfFact} onOpenShot={(i) => { setTab('shots'); setOpenShot(i); }} /> : needsShots('beat sheet'),
    assets: !blueprint ? needsBlueprint : assets.length ? <AssetBoard assets={assets} setAsset={setAsset} usage={usage} plates={boardPlates} /> : needsShots('assets'),
    shots: !blueprint ? needsBlueprint : shots.length ? (
      <ShotBoard
        shots={shots} assets={assets} cards={cards} scenes={scenes} scenesKnown={scenesFound(shots)} busy={!!busy}
        onOpen={setOpenShot} refsOf={(card) => cardRefs(card).list} boardCardOf={boardCardOf} onJump={onOpenOnBoard}
        locationName={(x) => assets.find((a) => a.key === x.location)?.name || ''}
        onScenes={runScenes} onRewriteCards={rewriteCards} onRewriteCard={rewriteCard}
        onBlock={blockOne} onDrawBlocking={drawBlocking} setBlocking={setBlocking}
        needsReopen={needsReopen} onReopen={reopen} onCircle={onCircleTake} secondsOf={(card) => secondsOfCard(shots, card)}
      />
    ) : needsShots('shots'),
  }[tab] || storyPanel;

  return (
    <div className="story-room" style={{ display: 'grid', gap: 14, textAlign: 'left' }}>
      <style>{'.story-room .arco-typography, .story-room textarea { word-break: normal; overflow-wrap: break-word; }'}</style>
      <div style={{ ...box, padding: '12px 16px', display: 'grid', gap: 10, position: 'sticky', top: 0, zIndex: 5, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {blueprint
            ? <Input id="story-room-title" value={blueprint.title || ''} onChange={(v) => setBlock('title', v)} placeholder="Untitled" style={{ maxWidth: 360, fontFamily: SCRIPT_FONT, fontWeight: 700, fontSize: 18, textTransform: 'uppercase', border: 'none', background: 'transparent', padding: 0 }} />
            : <Text style={{ fontFamily: SCRIPT_FONT, fontWeight: 700, fontSize: 18 }}>STORY ROOM</Text>}
          <OriginalityTag probe={source?.probe} />
          {projectTitle && <Text type="secondary" style={{ fontSize: 12 }}>Saved in {projectTitle.replace(/^Project\s+/, '')}</Text>}
          <span style={{ flex: 1 }} />
          {busy
            ? <Text style={{ fontSize: 12, color: '#4e5969' }}><IconLoading style={{ marginRight: 6 }} />{ROLE_LABEL[busy.role]} · {elapsed}s</Text>
            : planner && <Text type="secondary" style={{ fontSize: 12 }}>{planner.label} · effort {planner.effort}</Text>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div role="tablist" style={{ display: 'flex', gap: 2, background: '#f2f3f5', borderRadius: 8, padding: 3 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                style={{ border: 'none', cursor: 'pointer', padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: tab === t.id ? 600 : 500, background: tab === t.id ? '#fff' : 'transparent', color: tab === t.id ? '#1d2129' : '#4e5969', boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {t.label}
                {t.count != null && <span style={{ fontSize: 11, color: t.count === '●' ? '#00b42a' : '#86909c', fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {blueprint && <Button size="small" disabled={!canWrite} onClick={writeAllShots} title="Beat sheet → casting board + shot plan → one Seedance 2.5 shot per moment">{shots.length ? 'Rewrite shots' : 'Write shots'}</Button>}
          {assets.length > 0 && <Button size="small" icon={<IconSend />} disabled={!!busy} onClick={sendAssets} title="Renders every asset on the Film Agent board as Cast & World plates (characters: face + turnaround), in the Look">{`Cast & World · ${assets.length}`}</Button>}
          {blueprint && <Button size="small" type="primary" icon={<IconSend />} disabled={!!busy || problems.length > 0 || (shots.length > 0 && !missingCards)} onClick={syncToBoard} title={shots.length ? 'A SHOT card (Seedance 2.5) for every shot that has none yet — every shot then stays in step with its card' : 'Lands this story on the Film Agent board as a Storyboard card, verbatim'}>{!shots.length ? 'Send to Film Agent' : missingCards ? `Sync to board · +${missingCards}` : 'On the board ✓'}</Button>}
        </div>
      </div>

      {orphan && (
        <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderColor: '#bedaff', background: '#f2f7ff' }}>
          <Text style={{ fontSize: 13 }}>A story from before stories were saved in projects: <b>{orphan.blueprint?.title || String(orphan.idea || '').slice(0, 60)}</b></Text>
          <span style={{ flex: 1 }} />
          <Button size="small" type="primary" onClick={adoptOrphan}>Bring it into this project</Button>
        </div>
      )}

      {panel}

      <ShotDrawer
        index={openShot}
        shot={openShot != null ? shots[openShot] : null}
        shots={shots}
        assets={assets}
        facts={facts}
        card={openShot != null ? cards.find((c) => c.idx.includes(openShot)) : null}
        cardPrompt={cardPrompt}
        boardCardOf={boardCardOf}
        onClose={() => setOpenShot(null)}
        onGoto={(i) => setOpenShot(i)}
        setField={setShotField}
        toggleBinding={toggleBinding}
        onOpensScene={setOpensScene}
        onNewCard={setNewCard}
        onJump={(id) => { setOpenShot(null); onOpenOnBoard?.(id); }}
      />
    </div>
  );
};

export default StoryRoomPlayground;
