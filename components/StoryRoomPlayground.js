import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Modal, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconLoading, IconSend } from '@arco-design/web-react/icon';
import { createBrowserClient } from '../utils/film/core/client';
import { BLOCKS, BLOCK_CAP, SPINE_CAP, SCORE_KEYS, architectBlueprint, blueprintProblems, blueprintScript, critiqueBlueprint, factCoverage, fixShots, ideaText, planShots, probeOriginality, reviseBlueprint, scoutIdeas, storyFacts, verifyShots, writeShotPrompts } from '../utils/film/core/story';
import { REASONER_OPTIONS, getRuntime, reasonerSlotOf } from '../utils/film/suiteConfig';

const { Text } = Typography;

// STORY ROOM: an idea (yours, or one the Scout finds) → the story-builder blueprint →
// the Critic's stress test → a patch for the flagged blocks → the visual beat sheet (what
// the viewer must see or hear) → Seedance 2.5 shots that PROVE they show it → the Film
// Agent board. Every block and prompt stays editable; Critique / Verify re-check the screen.

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
  scout: 'Scout is finding ideas', probe: 'Checking originality', architect: 'Architect is building the blueprint', critic: 'Critic is stress-testing', reviser: 'Reviser is patching the flagged blocks',
  facts: 'Listing what the viewer must see and hear', plan: 'Planning the shots', shots: 'Writing the Seedance 2.5 prompts', verify: 'Checking each shot shows its facts', fix: 'Rewriting the shots that miss facts',
};
const FACT_CHIP = { shown: 'green', unverified: 'gold', missing: 'red', unassigned: 'red' };
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

const StoryRoomPlayground = ({ onSendToFilm }) => {
  const ctx = useMemo(() => ({ client: createBrowserClient() }), []);
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState(6);
  const [ideas, setIdeas] = useState([]); // [{ ...idea, probe }]
  const [source, setSource] = useState(null); // the idea the blueprint was built from: { text, probe }
  const [blueprint, setBlueprint] = useState(null);
  const [critique, setCritique] = useState(null);
  const [revised, setRevised] = useState([]); // blocks the last revision rewrote
  const [facts, setFacts] = useState([]); // the visual beat sheet: [{ id, block, kind, fact }]
  const [cast, setCast] = useState([]); // [{ name, look }]
  const [shots, setShots] = useState([]); // [{ title, location, shows, prompt, proofs, verified }]
  const [shotIssues, setShotIssues] = useState([]); // gate problems left after the retry
  const [busy, setBusy] = useState(null); // { role, at }
  const [elapsed, setElapsed] = useState(0);
  const hydrated = useRef(false);

  useEffect(() => {
    const s = load();
    if (typeof s.idea === 'string') setIdea(s.idea);
    if (Array.isArray(s.ideas)) setIdeas(s.ideas);
    if (s.source) setSource(s.source);
    if (s.blueprint) setBlueprint(s.blueprint);
    if (s.critique) setCritique(s.critique);
    if (Array.isArray(s.revised)) setRevised(s.revised);
    if (Array.isArray(s.facts)) setFacts(s.facts);
    if (Array.isArray(s.cast)) setCast(s.cast);
    if (Array.isArray(s.shots)) setShots(s.shots);
    if (Array.isArray(s.shotIssues)) setShotIssues(s.shotIssues);
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ idea, ideas, source, blueprint, critique, revised, facts, cast, shots, shotIssues })); } catch { /* quota — the session copy stands */ }
  }, [idea, ideas, source, blueprint, critique, revised, facts, cast, shots, shotIssues]);
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

  const plannerLabel = (REASONER_OPTIONS.find((o) => o.key === reasonerSlotOf()) || {}).label || 'planner';
  const problems = blueprint ? blueprintProblems(blueprint) : [];
  const fixCount = Object.keys(critique?.fix || {}).length;

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
    setCast([]);
    setShots([]);
    setShotIssues([]);
    if (left.length) Message.warning(`The blueprint still breaks ${left.length} check${left.length === 1 ? '' : 's'} — see below.`);
    setBusy({ role: 'critic', at: Date.now() });
    setCritique(await critiqueBlueprint({ blueprint: bp }, ctx));
  });

  const critiqueNow = () => run('critic', async () => { setCritique(await critiqueBlueprint({ blueprint }, ctx)); });

  // One revision round, then one re-score — the loop never runs on its own.
  const revise = () => run('reviser', async () => {
    const out = await reviseBlueprint({ blueprint, fix: critique?.fix || {} }, ctx);
    if (!out.changed.length) { Message.warning('The Reviser returned none of the flagged blocks — nothing changed.'); return; }
    setBlueprint({ ...out.blueprint, title: blueprint.title });
    setRevised(out.changed);
    setBusy({ role: 'critic', at: Date.now() });
    setCritique(await critiqueBlueprint({ blueprint: out.blueprint }, ctx));
  });

  const setBlock = (k, v) => {
    setBlueprint((b) => ({ ...b, [k]: k === 'journey' ? String(v).split('\n') : v }));
  };
  const cleanJourney = () => setBlueprint((b) => (b ? { ...b, journey: (b.journey || []).map((x) => x.trim()).filter(Boolean) } : b));

  // Write shots: the beat sheet (the contract) → the shot plan (which shot shows which
  // facts, coverage gated in code) → one Seedance 2.5 prompt per shot, three at a time →
  // the proof that each prompt shows what it claims.
  const note = (text) => Message.info({ content: text, duration: 6000 });
  const landShot = (i, shot) => setShots((list) => list.map((x, j) => (j === i ? shot : x)));
  const writeAllShots = () => run('facts', async () => {
    const f = await storyFacts({ blueprint, onNote: note }, ctx);
    setFacts(f.facts);
    setCast([]);
    setShots([]);
    setBusy({ role: 'plan', at: Date.now() });
    const plan = await planShots({ blueprint, facts: f.facts, onNote: note }, ctx);
    setCast(plan.cast);
    setShots(plan.shots);
    setBusy({ role: 'shots', at: Date.now() });
    const w = await writeShotPrompts({ blueprint, facts: f.facts, cast: plan.cast, shots: plan.shots, onNote: note, onShot: landShot }, ctx);
    setShots(w.shots);
    setShotIssues([...f.problems, ...plan.problems, ...w.problems]);
    setBusy({ role: 'verify', at: Date.now() });
    setShots(await verifyShots({ facts: f.facts, shots: w.shots }, ctx));
  });
  const verifyNow = () => run('verify', async () => { setShots(await verifyShots({ facts, shots }, ctx)); });
  const fixNow = () => run('fix', async () => {
    const out = await fixShots({ blueprint, facts, cast, shots, onNote: note, onShot: landShot }, ctx);
    if (!out.changed.length) { Message.info('Every fact is already in a shot that shows it.'); return; }
    setShots(out.shots);
    if (out.problems.length) setShotIssues(out.problems);
    setBusy({ role: 'verify', at: Date.now() });
    setShots(await verifyShots({ facts, shots: out.shots, only: out.changed }, ctx));
  });
  const setShotPrompt = (i, v) => setShots((list) => list.map((x, j) => (j === i ? { ...x, prompt: v, proofs: {}, verified: false } : x)));

  const coverage = factCoverage(facts, shots);
  const shownCount = coverage.filter((c) => c.status === 'shown').length;
  const fixable = coverage.some((c) => c.status === 'missing' || c.status === 'unassigned');

  const send = () => {
    if (!onSendToFilm) return;
    const title = blueprint.title || source?.title || '';
    if (!shots.length) { onSendToFilm({ script: blueprintScript(blueprint), title }); return; }
    const go = () => onSendToFilm({ shots: shots.map((x, i) => ({ title: `${i + 1} · ${x.title || 'Shot'}`, prompt: x.prompt })), title });
    const open = coverage.filter((c) => c.status !== 'shown');
    if (!open.length) { go(); return; }
    Modal.confirm({
      title: `${open.length} fact${open.length === 1 ? ' is' : 's are'} not shown`,
      content: <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{open.map((o) => `${o.id} ${facts.find((f) => f.id === o.id)?.fact || ''}`).join('\n')}</div>,
      okText: 'Send anyway',
      onOk: go,
    });
  };

  const box = { background: '#fff', border: '1px solid #e5e6eb', borderRadius: 10, padding: 16 };
  const capOf = (k) => (k === 'spine' ? SPINE_CAP : BLOCK_CAP);
  const countTag = (k, v) => {
    const n = k === 'journey' ? Math.max(0, ...(v || []).map(words)) : words(v);
    const over = n > capOf(k);
    return <Text style={{ fontSize: 11, color: over ? '#cb2634' : '#86909c', fontVariantNumeric: 'tabular-nums' }}>{k === 'journey' ? `longest ${n}/${capOf(k)}` : `${n}/${capOf(k)}`}</Text>;
  };

  return (
    <div style={{ display: 'grid', gap: 16, textAlign: 'left' }}>
      <div style={{ ...box, display: 'grid', gap: 10 }}>
        <Input.TextArea
          id="story-room-idea"
          value={idea}
          onChange={setIdea}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder="Your idea in your own words: a line, a character, a memory, a what-if. Or a direction for the Scout (a place, a world, a theme)."
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" disabled={!!busy || !idea.trim()} onClick={() => develop(idea)}>Develop this idea</Button>
          <Button disabled={!!busy} onClick={scout}>Scout ideas</Button>
          <InputNumber size="small" min={2} max={10} value={count} onChange={(v) => setCount(v || 6)} style={{ width: 72 }} aria-label="How many ideas to scout" />
          <span style={{ flex: 1 }} />
          {busy
            ? <Text style={{ fontSize: 12, color: '#4e5969' }}><IconLoading style={{ marginRight: 6 }} />{ROLE_LABEL[busy.role]} · {elapsed}s</Text>
            : <Text type="secondary" style={{ fontSize: 12 }}>{plannerLabel} · effort {getRuntime().reasoningEffort} · a step takes 1–4 min</Text>}
        </div>
      </div>

      {ideas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {ideas.map((x, i) => (
            <div key={`${x.title}-${i}`} style={{ ...box, padding: 14, display: 'grid', gap: 6, alignContent: 'start', borderColor: source?.title === x.title ? '#165dff' : '#e5e6eb' }}>
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
      )}

      {blueprint && (
        <div style={{ ...box, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Input id="story-room-title" value={blueprint.title || ''} onChange={(v) => setBlock('title', v)} placeholder="Title" style={{ maxWidth: 320, fontWeight: 600 }} />
            <OriginalityTag probe={source?.probe} />
            {critique && <Tag size="small" color={critique.total >= 14 ? 'green' : critique.total >= 10 ? 'orange' : 'red'}>Critic {critique.total}/{critique.max}</Tag>}
            <span style={{ flex: 1 }} />
            <Button size="small" disabled={!!busy} onClick={critiqueNow}>Critique</Button>
            <Button size="small" disabled={!!busy || !fixCount} onClick={revise}>Revise flagged{fixCount ? ` (${fixCount})` : ''}</Button>
            <Button size="small" disabled={!!busy || problems.length > 0} onClick={writeAllShots} title="The visual beat sheet, then one Seedance 2.5 prompt per shot, then the proof that each prompt shows its facts">{shots.length ? 'Rewrite shots' : 'Write shots'}</Button>
            <Button size="small" type="primary" icon={<IconSend />} disabled={!!busy || problems.length > 0} onClick={send} title={problems.length ? 'Fix the failing checks first' : shots.length ? 'Lands the shots on the Film Agent board as chained SHOT cards (Seedance 2.5), prompts verbatim' : 'Lands this story on the Film Agent board as a Storyboard card, verbatim'}>{shots.length ? `Send ${shots.length} shots` : 'Send to Film Agent'}</Button>
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text style={{ fontSize: 12, fontWeight: 600 }}>Spine</Text>{countTag('spine', blueprint.spine)}</div>
            <Input.TextArea id="story-room-spine" value={blueprint.spine} onChange={(v) => setBlock('spine', v)} autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontFamily: '"Courier Prime", "Courier New", monospace', background: '#f7f8fa' }} />
          </div>

          {problems.length > 0 && (
            <Text style={{ fontSize: 12, color: '#cb2634' }}>Checks failing: {problems.join(' · ')}</Text>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {BLOCKS.map((k) => {
              const note = critique?.fix?.[k];
              const v = blueprint[k];
              return (
                <div key={k} style={{ display: 'grid', gap: 4, alignContent: 'start', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: 600 }}>{BLOCK_LABEL[k]}</Text>
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
                    style={note ? { borderColor: '#ff9a2e' } : undefined}
                  />
                  {note && <Text style={{ fontSize: 12, color: '#d25f00' }}>Editor: {note}</Text>}
                </div>
              );
            })}
          </div>

          {critique && (
            <details>
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

      {blueprint && facts.length > 0 && (
        <div style={{ ...box, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontWeight: 600 }}>Visual beat sheet</Text>
            <Tag size="small" color={shownCount === facts.length ? 'green' : 'orange'}>{shownCount}/{facts.length} facts shown</Tag>
            <span style={{ flex: 1 }} />
            {shots.length > 0 && <Button size="small" disabled={!!busy} onClick={verifyNow}>Verify</Button>}
            {fixable && shots.length > 0 && <Button size="small" disabled={!!busy} onClick={fixNow}>Fix uncovered</Button>}
          </div>
          {shotIssues.length > 0 && <Text style={{ fontSize: 12, color: '#d25f00' }}>Still failing after the retry: {shotIssues.join(' · ')}</Text>}

          <div style={{ display: 'grid', gap: 6 }}>
            {facts.map((f, i) => {
              const c = coverage[i];
              const label = c.status === 'shown' ? `✓ shot ${c.provenIn.join(', ')}`
                : c.status === 'unverified' ? `? shot ${c.claimedBy.join(', ')} — verify`
                  : c.status === 'missing' ? `✗ claimed by shot ${c.claimedBy.join(', ')}, not in its prompt` : '✗ in no shot';
              return (
                <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 8, alignItems: 'start', fontSize: 13 }}>
                  <Text style={{ fontSize: 12, fontWeight: 600, color: '#86909c', fontVariantNumeric: 'tabular-nums' }}>{f.id}</Text>
                  <span style={{ minWidth: 0 }}><Text type="secondary" style={{ fontSize: 11 }}>{BLOCK_LABEL[f.block] || f.block} · {f.kind}</Text><br />{f.fact}</span>
                  <Tag size="small" color={FACT_CHIP[c.status]}>{label}</Tag>
                </div>
              );
            })}
          </div>

          {cast.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: 600 }}>Cast sheet</Text>
              {cast.map((c) => <Text key={c.name} style={{ fontSize: 12 }}><b>{c.name}</b> — {c.look}</Text>)}
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {shots.map((x, i) => (
              <div key={i} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12, fontWeight: 600 }}>Shot {i + 1} · {x.title}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{x.location}</Text>
                  {x.shows.map((id) => {
                    const proven = x.verified && x.proofs?.[id];
                    return (
                      <Tooltip key={id} content={proven ? `“${x.proofs[id]}”` : x.verified ? 'Not in this prompt' : 'Not checked since the last edit'}>
                        <Tag size="small" color={proven ? 'green' : x.verified ? 'red' : 'gold'}>{id}</Tag>
                      </Tooltip>
                    );
                  })}
                  <span style={{ flex: 1 }} />
                  <Text style={{ fontSize: 11, color: words(x.prompt) > 300 ? '#cb2634' : '#86909c', fontVariantNumeric: 'tabular-nums' }}>{words(x.prompt)}/300</Text>
                </div>
                {x.moment && <Text type="secondary" style={{ fontSize: 12 }}>{x.moment}</Text>}
                <Input.TextArea id={`story-room-shot-${i}`} value={x.prompt} onChange={(v) => setShotPrompt(i, v)} autoSize={{ minRows: 3, maxRows: 14 }} placeholder={busy ? 'Writing…' : 'No prompt yet'} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryRoomPlayground;
