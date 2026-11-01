import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { IconApps, IconAttachment, IconCheck, IconClose, IconLoading, IconRecordStop, IconSend } from '@arco-design/web-react/icon';
import { C, MONO } from '../studio/ui';
import RefDrawer from './canvas/RefDrawer';
import { ASSET_GROUPS } from '../../utils/film/studio/assets';

// THE SESSION: you say what you want, and every step the agent takes shows here as it happens.
// Everything that changes the project starts from this panel.

const STEP = {
  list_project: () => 'Reads the project',
  read_result: (a) => `Reads ${a.name}`,
  read_skill: (a) => `Reads the ${a.id || 'skill list'} skill`,
  generate_image: () => 'Makes a picture',
  edit_image: (a) => `Edits ${a.source}${a.marked ? ' using your marks' : ''}`,
  add_scene: (a) => `Adds the scene ${a.title}`,
  add_shot: (a) => `Adds the shot ${a.title}`,
  assemble: () => 'Assembles the cut',
  write_screenplay: () => 'Writes the screenplay',
  shot_list: () => 'Breaks the script down into shots',
  scene_views: () => "Draws the scene's camera views",
  cast: (a) => (a.names?.length ? `Draws ${a.names.join(', ')}` : 'Casts and draws the plates'),
  variations: (a) => `Draws ${a.count || 4} variations of ${a.element}`,
  storyboard: (a) => (a.panels ? `Draws a ${a.panels}-panel storyboard` : 'Draws a storyboard'),
  previz: () => 'Blocks the scene and draws the schematic',
  previz_animatic: (a) => `Renders the animatic of ${a.schematic}`,
  previz_shot_prompt: (a) => `Watches ${a.animatic} and writes the shot`,
  generate_video: (a) => `Renders a ${a.seconds || ''} s ${a.quality || ''} take`.replace(/ {2,}/g, ' '),
  edit_video: (a) => `Edits ${a.source}`,
  finish: (a) => `Makes the final of ${a.name}`,
  wait: (a) => `Waits for ${(a.names || []).join(', ')}`,
  look: (a) => `Looks at ${a.name}`,
  label: (a) => `Labels ${(a.names || []).join(', ')}`,
  place: (a) => `Places ${a.name}${a.element ? ` as ${a.element}` : ' on a shot'}`,
  pick: (a) => `Picks ${a.name}`,
  reject: (a) => `Rejects ${a.name}`,
  search_library: (a) => `Searches the Library${a.query ? ` for ${a.query}` : ''}`,
  use_from_library: () => 'Brings something in from the Library',
};
export const stepText = (e) => (STEP[e.tool] ? STEP[e.tool](e.args || {}) : e.tool);

// The events as a conversation: a step and its end become one line.
export const threadOf = (events) => {
  const out = [];
  const steps = new Map();
  events.slice(events.map((e) => e.type).lastIndexOf('reset') + 1).forEach((e) => {
    if (e.type === 'step') { const s = { ...e, kind: 'step', state: 'running' }; steps.set(e.id, s); out.push(s); return; }
    if (e.type === 'step_end') { const s = steps.get(e.id); if (s) Object.assign(s, { state: e.error ? 'error' : 'done', error: e.error, made: e.made }); return; }
    // The same error again in a row says nothing new.
    if (e.type === 'error' && out[out.length - 1]?.kind === 'error' && out[out.length - 1].text === e.text) return;
    if (['you', 'text', 'error', 'halted'].includes(e.type)) out.push({ ...e, kind: e.type });
  });
  return out;
};

const Step = ({ s, live }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 6, fontSize: 13.5, lineHeight: 1.5, color: s.state === 'error' ? C.warn : C.text }}>
    <span style={{ paddingTop: 1 }}>
      {s.state === 'running' && live && <IconLoading style={{ color: C.work }} />}
      {s.state === 'done' && <IconCheck style={{ color: C.good }} />}
      {s.state === 'error' && <IconClose />}
    </span>
    <span style={{ minWidth: 0 }}>
      {(s.args?.prompt || s.args?.instruction)
        ? (
          // What was actually sent: open it to read the prompt.
          <details>
            <summary style={{ cursor: 'pointer' }}>
              {stepText(s)}
              {s.made?.length > 0 && <span style={{ fontFamily: MONO, color: C.accent }}> → {s.made.join(', ')}</span>}
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '6px 0 0', padding: '9px 10px', fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: C.text, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, maxHeight: 320, overflow: 'auto' }}>{s.args.prompt || s.args.instruction}</pre>
          </details>
        )
        : (
          <>
            {stepText(s)}
            {s.made?.length > 0 && <span style={{ fontFamily: MONO, color: C.accent }}> → {s.made.join(', ')}</span>}
          </>
        )}
      {s.error && <span style={{ display: 'block', fontSize: 12.5, color: C.warn }}>{s.error}</span>}
    </span>
  </div>
);

const Line = ({ m, live, onShow, results }) => {
  if (m.kind === 'step') return <Step s={m} live={live} />;
  if (m.kind === 'you') {
    return (
      <div style={{ justifySelf: 'end', maxWidth: '90%', background: C.accentSoft, border: '1px solid rgba(255,150,38,0.22)', borderRadius: '12px 12px 4px 12px', padding: '9px 12px', fontSize: 14.5, color: C.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        <Names text={m.text} onShow={onShow} results={results} />
        {m.attached?.length > 0 && <div style={{ marginTop: m.text ? 6 : 0, fontSize: 12.5, color: C.text }}>{m.attached.map((a) => <div key={a.name}><b style={{ fontFamily: MONO, color: C.accent }}>{a.name}</b> {a.file}{a.problem ? <span style={{ color: C.warn }}> · {a.problem}</span> : null}</div>)}</div>}
      </div>
    );
  }
  if (m.kind === 'error') return <div style={{ fontSize: 14, color: C.bad, lineHeight: 1.5 }}>{m.text}</div>;
  if (m.kind === 'halted') return <div style={{ fontSize: 13, color: C.muted }}>{m.text}</div>;
  return <div style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}><Names text={m.text} onShow={onShow} results={results} /></div>;
};

// / COMMANDS: what the agent's Pi session has registered, typed at the start of a message.
export const matchCommands = (text, commands) => {
  const m = /^\/(\w*)$/.exec(String(text));
  return m ? commands.filter((c) => c.name.startsWith(m[1].toLowerCase())) : [];
};
// What a typed command asks for, or what is wrong with it. Null when the text isn't a command.
export const parseCommand = (text, results, commands = []) => {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(String(text).trim());
  if (!m) return null;
  if (!commands.some((c) => c.name === m[1].toLowerCase())) return { error: `No command /${m[1]}. Commands: ${commands.map((c) => `/${c.name}`).join(', ') || 'none yet'}.` };
  if (m[1].toLowerCase() !== 'edit') return { command: m[1].toLowerCase() };
  const target = /^@?([\p{L}\p{N}_-]+)\s*([\s\S]*)$/u.exec(m[2]);
  if (!target) return { error: 'Say which picture: /edit @R1' };
  const key = target[1].toLowerCase();
  const r = results.find((x) => x.name.toLowerCase() === key || String(x.mention || '').toLowerCase() === key);
  if (!r) return { error: `Nothing in this film is called @${target[1]}.` };
  if (r.type !== 'image') return { error: `${r.name} is a video. Editing works on pictures.` };
  if (r.status === 'running' || r.status === 'failed') return { error: `${r.name} is ${r.status === 'running' ? 'still rendering' : 'a failed render'}.` };
  return { command: 'edit', result: r, words: target[2].trim() };
};

// @ IN THE COMPOSER: the word being typed at the caret, the results it could mean, and the text with
// the choice put in.
export const mentionAt = (text, caret) => {
  const m = /(?:^|\s)@([\w-]*)$/.exec(String(text).slice(0, caret));
  return m ? { query: m[1], start: caret - m[1].length - 1 } : null;
};
// Grouped by type. Each shot and element shows its chosen or newest version; typing a short name
// finds any version.
const ORDER = Object.fromEntries(ASSET_GROUPS.map((g, i) => [g.key, i]));
const GROUP_LABEL = Object.fromEntries(ASSET_GROUPS.map((g) => [g.key, g.label]));
export const matchMentions = (results, query) => {
  const q = String(query || '').toLowerCase();
  const typeHit = (r) => q && String(GROUP_LABEL[r.group] || '').toLowerCase().startsWith(q);
  const words = (r) => [r.title, r.label, r.place, r.mention].map((x) => String(x || '').toLowerCase());
  const named = (r) => r.name.toLowerCase().startsWith(q);
  const hits = results.filter((r) => (!q && r.lead) || (q && (named(r) || ((typeHit(r) || words(r).some((w) => w.includes(q))) && r.lead))));
  return hits.sort((a, b) => (ORDER[a.group] - ORDER[b.group]) || ((b.at || 0) - (a.at || 0))).slice(0, 12);
};
export const putMention = (text, { start }, caret, name) => {
  const added = `@${name} `;
  return { text: `${text.slice(0, start)}${added}${text.slice(caret)}`, caret: start + added.length };
};

// Names in the conversation open that result on the right.
const Names = ({ text, onShow, results = [] }) => String(text || '').split(/(@[\p{L}\p{N}_-]+|\b[RT]\d+\b)/gu).map((part, i) => {
  const word = part.replace('@', '');
  const r = /^@|^[RT]\d+$/.test(part) ? results.find((x) => x.name === word || (x.mention || '').toLowerCase() === word.toLowerCase()) : null;
  if (r || /^@?[RT]\d+$/.test(part)) return <span key={i} role="button" onClick={() => onShow(r?.name || word)} style={{ fontFamily: MONO, color: C.accent, fontWeight: 600, cursor: 'pointer' }}>{part}</span>;
  return part;
});

const clock = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// What is rendering right now, whoever started it, always in sight above the composer.
export const Running = ({ running, onShow, atOf }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running.length) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running.length]);
  if (!running.length) return null;
  return (
    <div role="button" aria-label="Generations" onClick={onShow} style={{ cursor: 'pointer', display: 'grid', gap: 5, padding: '9px 12px', borderRadius: 11, background: C.workSoft, border: '1px solid rgba(76,195,255,0.25)' }}>
      {running.map((r) => (
        <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.text, minWidth: 0 }}>
          <IconLoading style={{ color: C.work, flex: '0 0 auto' }} />
          <b style={{ fontFamily: MONO, color: C.accent, flex: '0 0 auto' }}>{r.name}</b>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || `${r.res || ''} render`}</span>
          <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.work, flex: '0 0 auto' }}>{clock(Date.now() - (atOf(r) || Date.now()))}</span>
        </div>
      ))}
    </div>
  );
};

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, data_url: String(r.result) });
  r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  r.readAsDataURL(file);
});

const DRAWER_TABS = [{ key: 'all', label: 'All' }, ...ASSET_GROUPS, { key: 'library', label: 'Library' }];

export const Session = ({ events, busy, say, stop, head, running = [], results = [], commands: registered = [], library = [], onBrowse = () => {}, onUseLibrary = async () => null, onShowResult = () => {}, onShowRunning = () => {} }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [pending, setPending] = useState(null);
  const [problem, setProblem] = useState('');
  const [over, setOver] = useState(false);
  const end = useRef(null);
  const picker = useRef(null);
  const thread = threadOf(events);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [thread.length, pending]);
  // The server has it once it shows in the session.
  const youNow = events.filter((e) => e.type === 'you').length;
  useEffect(() => { if (pending && youNow > pending.youBefore) setPending(null); }, [youNow, pending]);
  const working = busy && !pending && !thread.some((m) => m.kind === 'step' && m.state === 'running');
  // The @ menu.
  const box = useRef(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const mention = closed ? null : mentionAt(text, caret);
  // /edit only takes pictures.
  const editing = /^\/edit\b/i.test(text);
  const options = mention ? matchMentions(editing ? results.filter((r) => r.type === 'image') : results, mention.query) : [];
  const commands = closed ? [] : matchCommands(text, registered);
  const useCommand = (c) => {
    const next = c.name === 'edit' ? '/edit @' : `/${c.name} `;
    setText(next);
    setCaret(next.length);
    setClosed(false);
    requestAnimationFrame(() => { const el = box.current?.querySelector('textarea'); if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } });
  };
  const readCaret = () => { const el = box.current?.querySelector('textarea'); if (el) setCaret(el.selectionStart); };
  const choose = (r) => {
    const next = putMention(text, mention, caret, r.mention || r.name);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => { const el = box.current?.querySelector('textarea'); if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); } });
  };
  // THE DRAWER: everything in the film and its Library, to browse. A click puts the reference in your
  // message, and a second click takes it out; nothing is sent.
  const [browsing, setBrowsing] = useState(false);
  const openDrawer = () => { setClosed(true); setBrowsing(true); onBrowse(); };
  const inFilm = results.filter((r) => r.status !== 'running' && r.status !== 'failed' && r.status !== 'rejected');
  const filmUrls = new Set(results.map((r) => r.url));
  const drawerItems = [
    ...inFilm.map((r) => ({ id: r.id, url: r.poster || (r.type === 'image' ? r.url : ''), label: `${r.name} · ${r.title}`, bucket: r.group, kind: r.type, tile: true, mention: r.mention || r.name })),
    ...library.filter((it) => !filmUrls.has(it.url)).map((it) => ({ id: it.id, url: it.thumb || (it.kind !== 'video' ? it.url : ''), label: it.name, bucket: 'library', kind: it.kind, tile: true, fromLibrary: true })),
  ];
  const mentioned = new Set((text.match(/@[\p{L}\p{N}_-]+/gu) || []).map((m) => m.slice(1).toLowerCase()));
  const drawerSelection = new Map(drawerItems.filter((it) => it.mention && mentioned.has(it.mention.toLowerCase())).map((it) => [it.id, '✓']));
  const toggleInDrawer = async (it) => {
    let word = it.mention;
    if (it.fromLibrary) {
      try { word = await onUseLibrary(it); } catch (e) { setProblem(e.message); return; }
    }
    setText((t) => {
      const token = new RegExp(`(^|\\s)@${word}(?=\\s|$)`, 'i');
      if (token.test(t)) return t.replace(token, '$1').replace(/ {2,}/g, ' ');
      return `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${word} `;
    });
  };
  const onKeys = (e) => {
    if (commands.length && e.key === 'Tab') { e.preventDefault(); useCommand(commands[0]); return; }
    if (commands.length && e.key === 'Escape') { e.preventDefault(); setClosed(true); return; }
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    if (e.key === 'Tab') { e.preventDefault(); choose(options[Math.min(active, options.length - 1)]); }
    if (e.key === 'Escape') { e.preventDefault(); setClosed(true); }
  };
  const addFiles = (list) => setFiles((f) => [...f, ...Array.from(list || [])]);
  // Your words show the moment you send them; what the server still has to do happens behind them.
  const send = async () => {
    if (!text.trim() && !files.length) return;
    const asked = parseCommand(text, results, registered);
    if (asked?.error) { setProblem(asked.error); return; }
    const was = { text, files };
    const youBefore = events.filter((e) => e.type === 'you').length;
    setPending({ text: text.trim(), files: files.map((f) => f.name), youBefore });
    setText('');
    setFiles([]);
    setProblem('');
    try {
      await say(was.text.trim(), await Promise.all(was.files.map(readFile)));
    } catch (e) {
      setPending(null);
      setText(was.text);
      setFiles(was.files);
      setProblem(e.message);
    }
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
      style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', background: over ? C.raised : C.panel }}
    >
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.line}`, minHeight: 28 }}>{head}</div>
      <div style={{ overflowY: 'auto', padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, alignContent: 'start' }}>
        {thread.length === 0 && <div style={{ color: C.text, fontSize: 15, lineHeight: 1.6 }}>Attach references or a clip and say what you want. Type @ to refer to anything in the film: “@T3 at 0:04, keep this light”.</div>}
        {thread.map((m) => <Line key={m.n} m={m} live={busy} onShow={onShowResult} results={results} />)}
        {pending && (
          <div style={{ justifySelf: 'end', maxWidth: '90%', background: C.accentSoft, border: '1px solid rgba(255,150,38,0.22)', borderRadius: '12px 12px 4px 12px', padding: '9px 12px', fontSize: 14.5, color: C.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {pending.text}
            {pending.files.length > 0 && <div className="st-pulse" style={{ marginTop: pending.text ? 6 : 0, fontSize: 12.5, color: C.text }}>Uploading {pending.files.join(', ')}</div>}
          </div>
        )}
        {working && <div className="st-pulse" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.text }}><IconLoading style={{ color: C.work }} />Thinking</div>}
        <div ref={end} />
      </div>
      <div style={{ padding: 14, borderTop: `1px solid ${C.line}`, display: 'grid', gap: 8 }}>
        <Running running={running} onShow={onShowRunning} atOf={(r) => r.at} />
        {problem && <div style={{ color: C.bad, fontSize: 13 }}>{problem}</div>}
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {files.map((f, i) => <span key={`${f.name}${i}`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5, color: C.text, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 8, padding: '3px 8px' }}>{f.name}<IconClose role="button" aria-label={`Remove ${f.name}`} style={{ cursor: 'pointer' }} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} /></span>)}
          </div>
        )}
        <div ref={box} style={{ position: 'relative', background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 14, padding: '8px 8px 8px 6px', display: 'flex', alignItems: 'flex-end', gap: 4 }}>
          {commands.length > 0 && (
            <div role="listbox" aria-label="Commands" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 12, padding: 5, zIndex: 5, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
              {commands.map((c) => (
                <div key={c.name} role="option" aria-selected className="st-row" onMouseDown={(e) => { e.preventDefault(); useCommand(c); }} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 9px', borderRadius: 8, cursor: 'pointer', background: C.hover }}>
                  <b style={{ fontFamily: MONO, color: C.accent, fontSize: 14 }}>/{c.name}</b>
                  <span style={{ fontSize: 13.5, color: C.text }}>{c.description}</span>
                </div>
              ))}
            </div>
          )}
          {mention && (
            <div role="listbox" aria-label="Results" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 12, padding: 5, zIndex: 5, boxShadow: '0 12px 30px rgba(0,0,0,0.45)', display: 'grid', gap: 1 }}>
              {!options.length && <div style={{ padding: '8px 10px', fontSize: 13.5, color: C.muted }}>{results.length ? 'Nothing matches.' : 'Nothing in this film yet. Attach something or ask for it.'}</div>}
              <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 1 }}>
                {options.map((r, i) => (
                  <div key={r.name}>
                    {(i === 0 || options[i - 1].group !== r.group) && <div style={{ padding: '7px 8px 3px', fontSize: 11.5, fontWeight: 700, color: C.muted }}>{GROUP_LABEL[r.group]}</div>}
                    <div role="option" aria-selected={i === active} className="st-row" onMouseDown={(e) => { e.preventDefault(); choose(r); }} onMouseEnter={() => setActive(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: i === active ? C.hover : 'transparent', minWidth: 0 }}>
                      <span style={{ width: 56, height: 32, borderRadius: 5, overflow: 'hidden', background: '#08090b', flex: '0 0 auto', display: 'grid', placeItems: 'center', color: C.work }}>
                        {r.status === 'running' ? <IconLoading style={{ fontSize: 12 }} /> : (r.poster || (r.type === 'image' && r.url)) ? <img src={r.poster || r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                        <span style={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.muted, flex: '0 0 auto' }}>{r.name}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div role="button" className="st-row" onMouseDown={(e) => { e.preventDefault(); openDrawer(); }} style={{ padding: '7px 8px', borderTop: `1px solid ${C.line}`, marginTop: 3, fontSize: 13, color: C.text, cursor: 'pointer', borderRadius: 6 }}>Browse everything</div>
            </div>
          )}
          <input ref={picker} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <Button type="text" shape="circle" icon={<IconAttachment />} aria-label="Attach" onClick={() => picker.current?.click()} style={{ flex: '0 0 auto', color: C.text }} />
          <Button type="text" shape="circle" icon={<IconApps />} aria-label="Browse" title="Browse everything in the film" onClick={openDrawer} style={{ flex: '0 0 auto', color: C.text }} />
          <Input.TextArea className="st-bare" aria-label="Say what you want" value={text} onChange={(v, e) => { setText(v); setCaret(e?.target?.selectionStart ?? v.length); setClosed(false); setActive(0); }} onKeyDown={onKeys} onKeyUp={readCaret} onClick={readCaret} autoSize={{ minRows: 1, maxRows: 8 }} onPressEnter={(e) => { if (e.shiftKey) return; e.preventDefault(); if (commands.length) useCommand(commands[0]); else if (options.length) choose(options[Math.min(active, options.length - 1)]); else send(); }} placeholder={busy ? 'Add something while it works' : 'Say what you want, @ for anything, / for commands'} style={{ fontSize: 15, lineHeight: 1.5 }} />
          {busy && <Button shape="circle" icon={<IconRecordStop />} aria-label="Stop" onClick={stop} style={{ flex: '0 0 auto' }} />}
          <Button type="primary" shape="circle" icon={<IconSend />} aria-label="Send" onClick={send} style={{ flex: '0 0 auto' }} />
        </div>
      </div>
      {browsing && <RefDrawer dark width={520} title="Everything in this film" hint="Click to add it to your message. Click again to take it out." items={drawerItems} tabs={DRAWER_TABS} selection={drawerSelection} onToggle={toggleInDrawer} onClose={() => setBrowsing(false)} />}
    </div>
  );
};
