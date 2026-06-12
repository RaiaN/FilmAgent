import { useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Tooltip, Typography } from '@arco-design/web-react';
import {
  IconClose, IconUpload, IconThunderbolt, IconLoading, IconUp, IconDown, IconDragDotVertical,
  IconRight, IconCopy, IconDownload,
} from '@arco-design/web-react/icon';
import { ADVERTISEMENT_RECIPE, AD_ROLE_META, LOOK_PACKAGES, adShotPlan, adInterviewRoles } from '../../../utils/film/recipes';
import { readFileAsDataUrl } from '../../../utils/film/canvasModel';

const { Text } = Typography;

const ASPECTS = [
  { label: '16:9 · TV / YouTube', value: '16:9' },
  { label: '9:16 · Reels / TikTok', value: '9:16' },
  { label: '1:1 · Feed', value: '1:1' },
];
const DURATIONS = ADVERTISEMENT_RECIPE.durations.map((d) => ({ label: `${d}s`, value: d }));
const LOOKS = Object.entries(LOOK_PACKAGES).map(([k, v]) => ({ label: v.label, value: k }));

let _mid = 0;
const mid = () => (_mid += 1);
const roleLabel = (r) => AD_ROLE_META[r]?.label || r;
const lowerLabel = (r) => roleLabel(r).toLowerCase();
const article = (r) => (/^[aeiou]/i.test(roleLabel(r)) ? 'an' : 'a');

// The Concierge as a CONVERSATION, not a form. The agent asks for what it needs one
// thing at a time (idea → frame → what you have → each missing asset → go), builds
// context, then follows the recipe blueprint end to end. The internal structure
// (bible, blueprint) is intact — it's just never dumped on the user all at once.
// All real work happens on the board via the FilmCanvas handlers passed in.
const ConciergeDock = ({
  apiKey, idea: ideaProp, recipe, bibleEntries = [], untaggedImageCount = 0, producing = false,
  onClose, onClassify, onGenerateGap, onUploadGap, onUpdateBrief, onReadIntent, onGenerateAd, onAction,
  onRoute, onDispatchRouted,
  traceCount = 0, onCopyTrace, onDownloadTrace,
}) => {
  const fileRef = useRef(null);
  const gapRoleRef = useRef(null);
  const scrollRef = useRef(null);

  // Captured context, built up turn by turn.
  const [idea, setIdea] = useState(ideaProp || '');
  const [draft, setDraft] = useState(ideaProp || '');
  const [durationSec, setDurationSec] = useState(recipe?.durationSec || ADVERTISEMENT_RECIPE.defaultDuration);
  const [aspect, setAspect] = useState(recipe?.aspect || ADVERTISEMENT_RECIPE.defaultAspect);
  const [look, setLook] = useState(recipe?.look || 'warmLifestyle');

  // Conversation state. stage = the current question; messages = the transcript.
  const [messages, setMessages] = useState([]);
  const [stage, setStage] = useState('idea');
  const [current, setCurrent] = useState(null); // the gap role being asked about
  const [genRole, setGenRole] = useState(null);  // a role currently generating
  // Free text is first-class at the turns where it means something: describe the
  // asset being asked about (steers its generation), or a final tweak before "go".
  const [gapDetail, setGapDetail] = useState('');
  const [readyNote, setReadyNote] = useState('');
  // The CONFIRMED ad intent (kind / hero & subjects / brandRelevant) — read by the
  // LLM from the idea, confirmed by the user in one tap. Drives which roles the
  // interview asks about and what their questions/generations mean. Rehydrates from
  // a recipe that already carries it (dock reopened mid-project).
  const [intent, setIntent] = useState(recipe?.kind ? { kind: recipe.kind, subjects: recipe.subjects || {}, brandRelevant: recipe.brandRelevant !== false, summary: '' } : null);
  const [pendingIntent, setPendingIntent] = useState(null); // awaiting the user's confirmation
  const intentRef = useRef(intent);
  useEffect(() => { intentRef.current = intent; }, [intent]);

  // The routed chat — free text BETWEEN the interview's questions (gaps-idle /
  // cuts-review / done): "generate me X" → the right agent, proposed back, one tap
  // runs it; a question → answered; commands ("make the ad", "action") just work.
  const [routeDraft, setRouteDraft] = useState('');
  const [routePending, setRoutePending] = useState(null); // routed action awaiting [Do it]
  const [routeBusy, setRouteBusy] = useState(false);      // reading the message
  const [routeWorking, setRouteWorking] = useState(false); // running the confirmed action

  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  // What we already have / have skipped — drives "only ask about real gaps". Refs so
  // the async interview never reads a stale snapshot.
  const haveRef = useRef(new Set((bibleEntries || []).map((b) => b.role)));
  const skippedRef = useRef(new Set());

  const say = (from, text) => setMessages((m) => [...m, { id: mid(), from, text }]);

  // Autoscroll the transcript as it grows.
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, stage]);

  // Reflect any roles tagged directly on the board (classify, manual badge) into what
  // we "have", so the interview never re-asks for something already in the bible.
  useEffect(() => { (bibleEntries || []).forEach((b) => haveRef.current.add(b.role)); }, [bibleEntries]);

  // ---- the interview script (recipe-driven, deterministic) -------------------
  // The role list adapts to the confirmed intent: a no-brand ad (cause / place /
  // brand-story) is never asked "do you have a logo?".
  const remainingGaps = () => adInterviewRoles(intentRef.current ? intentRef.current.brandRelevant !== false : true)
    .filter((r) => !haveRef.current.has(r) && !skippedRef.current.has(r));

  // What the role MEANS for this ad ("Hero" = the desert wildlife, not a gadget).
  const subjectFor = (role) => (intentRef.current?.subjects?.[role] || '').trim();

  const askReady = () => {
    setCurrent(null);
    setStage('ready');
    const beats = adShotPlan(durationSec).map((b) => b.beat);
    say('agent', `Perfect — I've got what I need. I'll cut a ${durationSec}s ${LOOK_PACKAGES[look]?.label.toLowerCase()} spot: ${beats.join(' → ')}. Want me to make it?`);
  };

  const askNextGap = () => {
    const rem = remainingGaps();
    if (!rem.length) { askReady(); return; }
    const role = rem[0];
    setCurrent(role);
    setGapDetail(''); // a fresh question — don't carry the previous asset's description
    setStage('gaps');
    const subj = subjectFor(role);
    // With a confirmed intent the question names the ACTUAL thing ("the running
    // trainers"), no role jargon — that's only needed when we know nothing.
    say('agent', subj
      ? `Do you have images of ${subj}? Upload them, or I'll generate it.`
      : `Do you have ${article(role)} ${roleLabel(role)}? — ${AD_ROLE_META[role]?.hint || ''} You can describe it and I'll generate to your description.`);
  };

  const startInventory = () => {
    const have = [...haveRef.current];
    if (have.length && !untaggedImageCount) {
      say('agent', `I can see your brand kit already has: ${have.map(roleLabel).join(', ')}. Let's fill any gaps.`);
      askNextGap();
      return;
    }
    setStage('inventory');
    say('agent', "Now — what have you already got? Drop your product shots, logo, spokesperson or references onto the board, then hit “Sort what I have”. Or start from scratch and I'll generate everything.");
  };

  const askLook = () => { setStage('look'); say('agent', 'And the vibe — pick a cinematic look:'); };
  const askDuration = () => { setStage('duration'); say('agent', 'How long should it run?'); };
  const askAspect = () => { setStage('aspect'); say('agent', 'Nice. Where will it run?'); };

  // Greeting + first question (once).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    say('agent', "Hi — I'm your ad concierge. Tell me what you're advertising and the one feeling it should leave, and I'll take it from there.");
  }, []);

  // ---- user actions ----------------------------------------------------------
  // Every captured answer writes through to the project IMMEDIATELY — gap
  // generation, classify and the producer all read project.idea/recipe, so a
  // deferred write (only at "Make the ad") starves them of context mid-interview.
  const submitIdea = async () => {
    const v = draft.trim();
    if (!v) { Message.warning("Tell me what you're advertising first"); return; }
    say('user', v);
    // Free local junk gate before spending a model call: too short / no letters
    // can't be a brief. The LLM judges everything subtler.
    if (v.length < 4 || !/[a-zA-Z؀-ۿ一-鿿]/.test(v)) {
      say('agent', "I need a real brief to work with — what are you advertising, and the one feeling it should leave? e.g. “a running shoe for night runners” or “a tourism film about AlUla”.");
      setStage('idea');
      return;
    }
    // Read the AD INTENT (one cheap LLM call). NOTHING is committed to the project
    // until the brief passes — garbage re-asks instead of advancing the interview.
    if (onReadIntent) {
      setStage('intent-read');
      const read = await onReadIntent(v);
      if (read && read.valid === false) {
        say('agent', read.clarify || "That doesn't read as an ad brief yet — tell me what you're advertising and the feeling it should leave.");
        setStage('idea');
        return;
      }
      if (read) {
        setIdea(v);
        if (onUpdateBrief) onUpdateBrief({ idea: v });
        setPendingIntent(read);
        const kindLabel = read.kind === 'brand-story' ? 'brand-story' : read.kind;
        say('agent', `${read.summary || `Sounds like a ${kindLabel} ad about ${read.subjects?.product || 'your subject'}.`} Did I get that right?`);
        setStage('confirm-intent');
        return;
      }
    }
    // Intent read unavailable/failed → proceed plain (the interview still works).
    setIdea(v);
    if (onUpdateBrief) onUpdateBrief({ idea: v });
    askAspect();
  };

  // Apply a confirmed (or corrected) intent, then continue the interview.
  const applyIntent = (next, userWords) => {
    setIntent(next);
    intentRef.current = next; // sync — askNextGap may run before the re-render
    setPendingIntent(null);
    if (onUpdateBrief) onUpdateBrief({ intent: next });
    say('user', userWords);
    askAspect();
  };
  const chooseAspect = (v, label) => { say('user', label); setAspect(v); if (onUpdateBrief) onUpdateBrief({ aspect: v }); askDuration(); };
  const chooseDuration = (v) => { say('user', `${v}s`); setDurationSec(v); if (onUpdateBrief) onUpdateBrief({ durationSec: v }); askLook(); };
  const chooseLook = (v, label) => { say('user', label); setLook(v); if (onUpdateBrief) onUpdateBrief({ look: v }); startInventory(); };

  const doSort = async () => {
    say('user', 'Sort what I have');
    setStage('working');
    const found = (await onClassify()) || [];
    found.forEach((r) => haveRef.current.add(r));
    if (found.length) {
      const counts = {};
      found.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
      say('agent', `Sorted them onto the board: ${Object.entries(counts).map(([r, n]) => `${n} ${roleLabel(r)}`).join(', ')}. Now let's check what's missing.`);
    } else {
      say('agent', "I couldn't auto-sort those — no worries, we'll just go through what the ad needs.");
    }
    askNextGap();
  };
  const startScratch = () => { say('user', "I'm starting from scratch"); say('agent', "No problem — I'll generate what we need. Let's go through it."); askNextGap(); };

  const generateCurrent = async () => {
    const role = current;
    // The user's typed description wins; otherwise the intent's subject steers the
    // generation (so "Generate it" for the hero makes desert wildlife, not a gadget).
    const typed = gapDetail.trim();
    const detail = typed || subjectFor(role);
    // The transcript shows what the user actually said — their description IS the turn.
    say('user', typed || `Generate ${article(role)} ${lowerLabel(role)} for me`);
    setGapDetail('');
    setGenRole(role);
    const ok = await onGenerateGap(role, detail);
    setGenRole(null);
    if (ok) { haveRef.current.add(role); say('agent', `Done — it's on your board.`); askNextGap(); }
    else { say('agent', `That one didn't generate. Want to Upload it or Skip for now?`); }
  };
  const skipCurrent = () => { skippedRef.current.add(current); say('user', `Skip the ${lowerLabel(current)}`); askNextGap(); };
  const uploadCurrent = () => { gapRoleRef.current = current; fileRef.current?.click(); };

  const generateRest = async () => {
    const rem = remainingGaps();
    if (!rem.length) { askReady(); return; }
    say('user', 'Generate the rest for me');
    setStage('working');
    say('agent', `On it — generating ${rem.length} asset${rem.length > 1 ? 's' : ''}: ${rem.map(roleLabel).join(', ')}.`);
    const results = await Promise.all(rem.map((r) => onGenerateGap(r, subjectFor(r)).then((ok) => ({ r, ok: !!ok }))));
    results.forEach(({ r, ok }) => { if (ok) haveRef.current.add(r); });
    const failed = results.filter((x) => !x.ok).map((x) => x.r);
    if (failed.length) say('agent', `Couldn't generate: ${failed.map(roleLabel).join(', ')} — you can Upload or Skip those.`);
    askNextGap();
  };

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    const role = gapRoleRef.current || current || 'product';
    gapRoleRef.current = null;
    e.target.value = '';
    let added = false;
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      if (!f.type || !f.type.startsWith('image/')) continue; // eslint-disable-line no-continue
      try {
        const dataUrl = await readFileAsDataUrl(f); // eslint-disable-line no-await-in-loop
        onUploadGap({ role, dataUrl, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) });
        added = true;
      } catch { /* skip unreadable */ }
    }
    if (added) {
      haveRef.current.add(role);
      say('user', `Uploaded ${article(role)} ${lowerLabel(role)}`);
      say('agent', `Got it — your ${lowerLabel(role)} is on the board.`);
      askNextGap();
    }
  };

  // "Make the ad" now LAYS OUT the cuts for review — the user refines each CUT
  // card's prompt/assets/duration on the board, then 🎬 Action actually shoots.
  // `silent` = invoked by the routed chat, which already echoed the user's words.
  const doGenerate = (silent = false) => {
    const note = readyNote.trim();
    // A last-minute tweak folds into the idea, so every shot's prompt carries it.
    const finalIdea = note ? `${idea.trim()}. ${note}` : idea.trim();
    if (!silent) say('user', note || 'Make the ad');
    if (note) setIdea(finalIdea);
    setReadyNote('');
    const mode = onGenerateAd({ idea: finalIdea, durationSec, aspect, look });
    if (mode === 'review') {
      setStage('cuts-review');
      say('agent', `I've laid the ${adShotPlan(durationSec).length} cuts out on the board — each card is one shot: what it shows, its camera move and motion, its length, and the assets feeding it (the dashed lines; drop any board image onto a card to add it). Each card previews the exact full prompts it will send. Try a single cut with its 🎬 button, then hit 🎬 Action and I'll shoot the rest and assemble — cuts you already shot keep their take.`);
    } else {
      setStage('producing');
      say('agent', `Rolling. Building your ${durationSec}s cut now — watch the board and timeline fill in. I'll log every step in History.`);
    }
  };

  const doAction = (silent = false) => {
    if (!silent) say('user', '🎬 Action');
    setStage('producing');
    say('agent', "Rolling — shooting the cuts as specified. Watch the timeline fill in; every step lands in History.");
    if (onAction) onAction();
  };

  // ---- the routed chat (between interview questions) --------------------------
  // LLM interprets; the user confirms; the dispatch is deterministic. Commands map
  // straight onto the existing buttons; only generations need a [Do it].
  const dispatchRouted = async (routed) => {
    setRoutePending(null);
    setRouteWorking(true);
    try {
      const reply = await onDispatchRouted(routed.action, routed);
      say('agent', reply || 'Done.');
    } catch (err) {
      say('agent', `That didn't work: ${err.message}`);
    } finally {
      setRouteWorking(false);
    }
  };

  const sendRouted = async () => {
    const text = routeDraft.trim();
    if (!text || routeBusy || routeWorking || !onRoute) return;
    say('user', text);
    setRouteDraft('');
    setRoutePending(null);
    setRouteBusy(true);
    try {
      const routed = await onRoute(text, stage);
      if (!routed || routed.action === 'unknown') {
        say('agent', "I didn't catch that. Ask me anything about the project, or tell me what to make — “3 night versions of the street”, “sort what I have”, “make the ad”.");
        return;
      }
      // A question → the router answered it directly; no tool, no confirmation.
      if (routed.action === 'answer') { say('agent', routed.say || "I don't have a good answer for that — try asking differently."); return; }
      // Spoken commands = the existing buttons; laying out cuts costs nothing and
      // Action's review gate is the cards themselves — both dispatch directly.
      if (routed.action === 'makeAd' || routed.action === 'relayCuts') { doGenerate(true); return; }
      if (routed.action === 'action') {
        if (stage === 'cuts-review') doAction(true);
        else say('agent', 'Nothing is staged to shoot yet — say “make the ad” first and I\'ll lay the cuts out for review.');
        return;
      }
      // A generation → propose it in plain words; one tap spends.
      setRoutePending(routed);
      say('agent', routed.say || `I'll run ${routed.action}. Go?`);
    } catch (err) {
      say('agent', `That didn't go through: ${err.message}`);
    } finally {
      setRouteBusy(false);
    }
  };

  // When the producer finishes, close the loop conversationally.
  const wasProducing = useRef(false);
  useEffect(() => {
    if (producing) { wasProducing.current = true; return; }
    if (wasProducing.current) {
      wasProducing.current = false;
      if (stage === 'producing') { say('agent', "Done — your cut's on the timeline. Press ▶ to watch, tweak any clip, or open History to see every decision I made."); setStage('done'); }
    }
  }, [producing]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = () => {
    haveRef.current = new Set((bibleEntries || []).map((b) => b.role));
    skippedRef.current = new Set();
    setMessages([]);
    started.current = false;
    setStage('idea');
    setCurrent(null);
    setIntent(null);
    intentRef.current = null;
    setPendingIntent(null);
    say('agent', "Fresh start. What are we advertising, and the one feeling it should leave?");
  };

  // ---- drag (pointer-capture; bail on buttons so the ×/collapse clicks work) ---
  const onDragStart = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onDragMove = (e) => { const d = dragRef.current; if (d) setPos({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }); };
  const onDragEnd = (e) => { dragRef.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ } };

  // ---- chrome ----------------------------------------------------------------
  const dock = {
    position: 'absolute', top: 12, right: 12, zIndex: 9, width: 340, maxWidth: 'calc(100% - 24px)',
    transform: `translate(${pos.x}px, ${pos.y}px)`,
    background: '#fff', border: '1px solid #e5e6eb', borderRadius: 12,
    boxShadow: '0 10px 34px rgba(0,0,0,0.16)', overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  };
  const header = (
    <div
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#5a3df0', color: '#fff', cursor: 'grab', userSelect: 'none', touchAction: 'none', flexShrink: 0 }}
    >
      <IconDragDotVertical style={{ fontSize: 14, opacity: 0.85 }} />
      <Text style={{ color: '#fff', fontWeight: 700, fontSize: 13, flex: 1 }}>Ad concierge</Text>
      <Tooltip content={collapsed ? 'Expand' : 'Collapse'}>
        <Button size="mini" type="text" style={{ color: '#fff' }} icon={collapsed ? <IconDown /> : <IconUp />} onClick={() => setCollapsed((v) => !v)} />
      </Tooltip>
      <Tooltip content="Close"><Button size="mini" type="text" style={{ color: '#fff' }} icon={<IconClose />} onClick={onClose} /></Tooltip>
    </div>
  );

  const runLog = (onCopyTrace || onDownloadTrace) ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid #f2f3f5', flexShrink: 0 }}>
      <Tooltip content="Every prompt + decision this run — open History for the full tree.">
        <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>Run log{traceCount ? ` · ${traceCount}` : ''}</Text>
      </Tooltip>
      <Button size="mini" icon={<IconCopy />} disabled={!traceCount} onClick={onCopyTrace}>Copy</Button>
      <Button size="mini" icon={<IconDownload />} disabled={!traceCount} onClick={onDownloadTrace}>.txt</Button>
    </div>
  ) : null;

  // ---- composer (the active turn's controls) ---------------------------------
  const Chips = ({ options, onChoose }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => <Button key={o.value} size="small" onClick={() => onChoose(o.value, o.label)}>{o.label}</Button>)}
    </div>
  );

  // The routed free-text row — lives only BETWEEN the interview's questions
  // (gaps-idle / cuts-review / done), so an interview answer is never mistaken
  // for a command. Pending proposal = the one-tap spend gate.
  const routedRow = onRoute ? (
    <>
      {routePending && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="small" type="primary" loading={routeWorking} onClick={() => dispatchRouted(routePending)} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>Do it</Button>
          <Button size="small" disabled={routeWorking} onClick={() => { setRoutePending(null); say('user', 'Not that'); say('agent', 'Okay — tell me differently.'); }}>Not that</Button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <Input.TextArea
          value={routeDraft}
          onChange={setRouteDraft}
          disabled={routeBusy || routeWorking}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); sendRouted(); } }}
          placeholder="Ask me anything, or tell me what to make…"
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          type="primary"
          icon={(routeBusy || routeWorking) ? <IconLoading /> : <IconRight />}
          disabled={!routeDraft.trim() || routeBusy || routeWorking}
          style={{ background: '#5a3df0', borderColor: '#5a3df0' }}
          onClick={sendRouted}
        />
      </div>
    </>
  ) : null;

  let composer = null;
  if (stage === 'idea') {
    composer = (
      <div>
        <Input.TextArea
          autoFocus
          value={draft}
          onChange={setDraft}
          onPressEnter={(e) => { if (e.metaKey || e.ctrlKey) submitIdea(); }}
          placeholder="e.g. a running shoe that should feel like effortless speed at dawn"
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <div style={{ textAlign: 'right', marginTop: 6 }}>
          <Button type="primary" size="small" icon={<IconRight />} onClick={submitIdea} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>Send</Button>
        </div>
      </div>
    );
  } else if (stage === 'intent-read') {
    composer = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconLoading style={{ color: '#5a3df0' }} /><Text type="secondary" style={{ fontSize: 12 }}>Reading your brief…</Text></span>;
  } else if (stage === 'confirm-intent' && pendingIntent) {
    composer = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button type="primary" size="small" onClick={() => applyIntent(pendingIntent, "That's right")} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>That&rsquo;s right</Button>
        {pendingIntent.kind !== 'product' ? (
          <Button size="small" onClick={() => applyIntent({ ...pendingIntent, kind: 'product', brandRelevant: true }, "No — it's a product ad")}>No — it&rsquo;s a product ad</Button>
        ) : (
          <Button size="small" onClick={() => applyIntent({ ...pendingIntent, kind: 'brand-story', brandRelevant: false }, "No — it's a brand / cause story")}>No — it&rsquo;s a brand / cause story</Button>
        )}
      </div>
    );
  } else if (stage === 'aspect') {
    composer = <Chips options={ASPECTS} onChoose={chooseAspect} />;
  } else if (stage === 'duration') {
    composer = <Chips options={DURATIONS} onChoose={chooseDuration} />;
  } else if (stage === 'look') {
    composer = <Chips options={LOOKS} onChoose={chooseLook} />;
  } else if (stage === 'inventory') {
    composer = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button type="primary" size="small" icon={<IconThunderbolt />} disabled={!untaggedImageCount} onClick={doSort} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>
          Sort what I have{untaggedImageCount ? ` (${untaggedImageCount})` : ''}
        </Button>
        <Button size="small" onClick={startScratch}>Start from scratch</Button>
      </div>
    );
  } else if (stage === 'gaps' && current) {
    composer = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input.TextArea
          value={gapDetail}
          onChange={setGapDetail}
          disabled={!!genRole}
          onPressEnter={(e) => { if (e.metaKey || e.ctrlKey) generateCurrent(); }}
          placeholder={`Describe the ${lowerLabel(current)} you have in mind (optional) — I'll generate exactly that`}
          autoSize={{ minRows: 1, maxRows: 3 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="small" icon={<IconUpload />} disabled={!!genRole} onClick={uploadCurrent}>Upload</Button>
          <Button size="small" type="primary" loading={genRole === current} icon={genRole === current ? <IconLoading /> : <IconThunderbolt />} disabled={!!genRole} onClick={generateCurrent}>{gapDetail.trim() ? 'Generate this' : 'Generate it'}</Button>
          <Button size="small" disabled={!!genRole} onClick={skipCurrent}>Skip</Button>
        </div>
        <Button size="mini" type="text" disabled={!!genRole} onClick={generateRest} style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>⚡ Generate the rest for me</Button>
      </div>
    );
  } else if (stage === 'ready') {
    composer = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input.TextArea
          value={readyNote}
          onChange={setReadyNote}
          onPressEnter={(e) => { if (e.metaKey || e.ctrlKey) doGenerate(); }}
          placeholder="Anything to add or change before I shoot? (optional) — it steers every shot"
          autoSize={{ minRows: 1, maxRows: 3 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button type="primary" size="small" icon={<IconThunderbolt />} onClick={() => doGenerate()} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>Make the ad →</Button>
          <Button size="small" onClick={() => { say('user', "I'll tweak first"); say('agent', "Sure — adjust roles on the board or drop more in, then say “Make the ad”."); setStage('gaps-idle'); }}>Not yet</Button>
        </div>
      </div>
    );
  } else if (stage === 'cuts-review') {
    composer = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button type="primary" size="small" icon={<IconThunderbolt />} onClick={() => doAction()} style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>🎬 Action — shoot the cuts</Button>
          <Button size="small" onClick={() => { say('user', 'Re-lay the cuts'); doGenerate(true); }}>Re-lay cuts</Button>
        </div>
        {routedRow}
      </div>
    );
  } else if (stage === 'gaps-idle') {
    composer = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Button type="primary" size="small" icon={<IconThunderbolt />} onClick={askReady} style={{ background: '#5a3df0', borderColor: '#5a3df0', alignSelf: 'flex-start' }}>I'm ready — make the ad</Button>
        {routedRow}
      </div>
    );
  } else if (stage === 'working') {
    composer = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconLoading style={{ color: '#5a3df0' }} /><Text type="secondary" style={{ fontSize: 12 }}>Working…</Text></span>;
  } else if (stage === 'producing') {
    composer = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconLoading style={{ color: '#5a3df0' }} /><Text style={{ fontSize: 12 }}>Generating your cut…</Text></span>;
  } else if (stage === 'done') {
    composer = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Button size="small" icon={<IconThunderbolt />} onClick={restart} style={{ alignSelf: 'flex-start' }}>Make another ad</Button>
        {routedRow}
      </div>
    );
  }

  return (
    <div style={dock}>
      {header}
      {!collapsed && (
        <>
          <div ref={scrollRef} className="nowheel" style={{ overflowY: 'auto', padding: '12px 12px 6px', minHeight: 140, maxHeight: 'calc(82vh - 240px)' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{
                  maxWidth: '85%', fontSize: 13, lineHeight: 1.45, padding: '7px 10px', borderRadius: 12,
                  background: m.from === 'user' ? '#5a3df0' : '#f2f3f5',
                  color: m.from === 'user' ? '#fff' : '#1d2129',
                  borderTopRightRadius: m.from === 'user' ? 3 : 12,
                  borderTopLeftRadius: m.from === 'user' ? 12 : 3,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{m.text}</div>
              </div>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPick} />
          <div style={{ borderTop: '1px solid #f2f3f5', padding: 10, flexShrink: 0 }}>
            {composer}
            {!apiKey?.trim() && (
              <Text type="error" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Add your API key (⚙ far-left) so I can classify & generate.</Text>
            )}
          </div>
          {runLog}
        </>
      )}
    </div>
  );
};

export default ConciergeDock;
