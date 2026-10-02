import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconLoading, IconSend } from '@arco-design/web-react/icon';
import { createBrowserClient } from '../utils/film/core/client';
import { makeThumbnail } from '../utils/film/canvasModel';
import { AssetBoard, BeatSheet, Empty, LINE, LookPanel, SCRIPT_FONT, ShotBoard, ShotDrawer, platesFor } from './storyroom/panels';
import { BLOCKS, BLOCK_CAP, SPINE_CAP, SCORE_KEYS, architectBlueprint, blueprintProblems, blueprintScript, critiqueBlueprint, ideaText, planShots, probeOriginality, renderShotPrompt, boundAssets, fixOptions, flaggedFixes, scoutIdeas, storyFacts, writeShotBodies, castDesignOf, describeLook, lookPresets, detectScenes, sceneNumbers, linkOf } from '../utils/film/core/story';
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
  facts: 'Listing what the viewer must see and hear', plan: 'Planning the assets and shots', shots: 'Writing the Seedance 2.5 shots', scenes: 'Finding the scene changes',
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

const StoryRoomPlayground = ({ onSendToFilm, onOpenOnBoard, onLinks, onPinTake, boardPlates = [], boardShots = [], projectStory = null, projectTitle = '', onStoryChange }) => {
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
  // and facts) → one Seedance 2.5 shot body per shot, three at a time. Prompts are
  // RENDERED from the roster, so every shot carries the same look words.
  const note = (text) => Message.info({ content: text, duration: 6000 });
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
    setBusy({ role: 'shots', at: Date.now() });
    const landShot = (i, shot) => setShots((list) => list.map((x, j) => (j === i ? shot : x)));
    const w = await writeShotBodies({ blueprint, facts: f, assets: plan.assets, shots: plan.shots, onNote: note, onShot: landShot }, ctx);
    setShots(w.shots);
    if (w.failed.length) Message.warning({ content: w.failed.join(' · '), duration: 8000 });
    setBusy({ role: 'scenes', at: Date.now() });
    setShots(await detectScenes({ shots: w.shots, assets: plan.assets }, ctx));
  });
  // Scenes: where place or time changes. A shot's continuity link (linkOf) follows the
  // scenes unless set by hand: the previous shot in the same scene, as its state.
  const runScenes = () => run('scenes', async () => { setShots(await detectScenes({ shots, assets }, ctx)); });
  const toggleScene = (i) => setShots((list) => {
    if (i < 1) return list; // the first shot always opens a scene
    const nums = sceneNumbers(list);
    const breaksNow = nums[i] !== nums[i - 1];
    return list.map((x, j) => (j === i ? { ...x, newScene: !breaksNow, sceneUser: true, sceneReason: 'Set by you.' } : x));
  });
  const scenes = sceneNumbers(shots);
  const consistencyOf = (i) => {
    const l = linkOf(shots, i);
    return l ? { ...l, card: cardOf(l.from) } : null;
  };
  // 'auto' hands the link back to the scenes; anything else pins it by hand.
  const setLink = (i, patch) => setShots((list) => list.map((x, j) => {
    if (j !== i) return x;
    if (patch === 'auto') { const { link, ...rest } = x; return rest; }
    const cur = linkOf(list, i) || { from: null, mode: 'state' };
    return { ...x, link: { from: cur.from, mode: cur.mode, ...patch, user: true } };
  }));
  const setShotBody = (i, v) => setShots((list) => list.map((x, j) => (j === i ? { ...x, body: v } : x)));
  const setAsset = (key, field, v) => setAssets((list) => list.map((a) => (a.key === key ? { ...a, [field]: v } : a)));
  const toggleBinding = (i, key) => setShots((list) => list.map((x, j) => (j === i ? { ...x, assets: x.assets.includes(key) ? x.assets.filter((k) => k !== key) : [...x.assets, key] } : x)));
  const shotsOfFact = (id) => shots.map((x, i) => (x.shows.includes(id) ? i + 1 : 0)).filter(Boolean);
  const usage = (key) => shots.filter((x) => x.location === key || x.assets.includes(key)).length;

  // A shot's reference images: the board plates of its bound assets (characters, props,
  // then the location — boundAssets' order), one per asset, numbered @Image1..N.
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
  // A shot's card on the board: the one stamped by the last Send, else the newest card
  // carrying this shot's "N · Title" label.
  const cardOf = (i) => {
    const stamped = boardShots.find((c) => sendId && c.sendId === sendId && c.index === i);
    if (stamped) return stamped;
    const label = `${i + 1} · ${shots[i]?.title || 'Shot'}`;
    return boardShots.filter((c) => c.beat === label).sort((a, b) => (a.cardId < b.cardId ? 1 : -1))[0] || null;
  };
  // Every sent shot's link, pushed to its card on the board — cards sent earlier and
  // links edited after Send stay in step. Pushed only when something changed.
  const linksSent = useRef('');
  useEffect(() => {
    if (!onLinks) return;
    const out = [];
    shots.forEach((x, i) => {
      const c = cardOf(i);
      if (!c) return;
      const l = linkOf(shots, i);
      const src = l ? cardOf(l.from) : null;
      out.push({ cardId: c.cardId, from: src ? src.cardId : null, mode: l?.mode || 'state' });
    });
    const key = JSON.stringify(out);
    if (key === linksSent.current) return;
    linksSent.current = key;
    onLinks(out);
  }, [shots, boardShots, sendId]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    if (!onSendToFilm) return;
    const title = blueprint.title || source?.title || '';
    if (!shots.length) { onSendToFilm({ script: blueprintScript(blueprint), title }); return; }
    const id = `send-${Date.now().toString(36)}`;
    setSendId(id);
    onSendToFilm({ sendId: id, shots: shots.map((x, i) => { const r = shotRefs(x); const l = linkOf(shots, i); return { title: `${i + 1} · ${x.title || 'Shot'}`, prompt: renderShotPrompt(x, assets, look, r.numbers), refNodeIds: r.list.map((p) => p.nodeId), link: l ? { from: l.from, mode: l.mode } : null }; }), title });
  };
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
    shots: !blueprint ? needsBlueprint : shots.length ? <ShotBoard shots={shots} assets={assets} onOpen={setOpenShot} busy={!!busy} refsOf={(x) => shotRefs(x).list} cardOf={cardOf} onJump={onOpenOnBoard} scenes={scenes} consistencyOf={consistencyOf} locationName={(x) => assets.find((a) => a.key === x.location)?.name || ''} onScenes={runScenes} /> : needsShots('shots'),
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
          {blueprint && <Button size="small" type="primary" icon={<IconSend />} disabled={!!busy || problems.length > 0} onClick={send} title={shots.length ? 'Lands the shots on the Film Agent board as chained SHOT cards (Seedance 2.5)' : 'Lands this story on the Film Agent board as a Storyboard card, verbatim'}>{shots.length ? `Send ${shots.length} shots` : 'Send to Film Agent'}</Button>}
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
        look={look}
        onClose={() => setOpenShot(null)}
        onPrev={() => setOpenShot((i) => Math.max(0, i - 1))}
        onNext={() => setOpenShot((i) => Math.min(shots.length - 1, i + 1))}
        setBody={setShotBody}
        toggleBinding={toggleBinding}
        renderPrompt={(x) => renderShotPrompt(x, assets, look, shotRefs(x).numbers)}
        refsOf={(x) => shotRefs(x).list}
        boardCard={openShot != null ? cardOf(openShot) : null}
        onJump={(id) => { setOpenShot(null); onOpenOnBoard?.(id); }}
        scene={openShot != null ? scenes[openShot] : null}
        opensScene={openShot != null && (openShot === 0 || scenes[openShot] !== scenes[openShot - 1])}
        consistency={openShot != null ? consistencyOf(openShot) : null}
        onToggleScene={() => openShot != null && toggleScene(openShot)}
        onSetLink={setLink}
        onPinTake={onPinTake}
      />
    </div>
  );
};

export default StoryRoomPlayground;
