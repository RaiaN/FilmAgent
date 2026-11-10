import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Input, Menu, Message } from '@arco-design/web-react';
import { IconSettings } from '@arco-design/web-react/icon';
import { C, MONO, STUDIO_CSS } from '../studio/ui';
import GenerationsView from '../studio/GenerationsView';
import { emptyStudio } from '../../utils/film/studio/model';
import { deleteFromLibrary, listLibrary } from '../../utils/film/libraryStore';
import { Session } from './Session';
import { Preview } from './Preview';
import { Library } from './Library';
import { EditImage } from './EditImage';

// FILMAGENT: the session on the left drives everything; the right only shows the film and organises
// it. The film is the project open in the app, the same one Studio shows, and a new project starts
// with its first sentence.

const postJson = async (path, body) => {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `${path} answered ${res.status}`);
  return out;
};
const tool = (name, args) => postJson('/api/film/tools', { tool: name, args });

const SESSION_POLL_MS = 700;
const FILM_POLL_MS = 1500;
const SESSION_WIDTH = 460;
const VIEWS = [['preview', 'Preview'], ['generations', 'Generations'], ['library', 'Library']];

// The film's title, click to rename, and the same project menu Studio has.
const Head = ({ project }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const title = String(project?.title || '').replace(/^Project\s+/, '').replace(/^"|"$/g, '');
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) project.rename(next);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      {editing
        ? <span style={{ flex: 1, minWidth: 0 }}><Input aria-label="Film name" autoFocus value={draft} onChange={setDraft} onBlur={commit} onPressEnter={commit} /></span>
        : <span role="button" title="Rename" onClick={() => { setDraft(title); setEditing(true); }} style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: C.ink, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Untitled'}</span>}
      <span role="button" className="st-ghost" onClick={() => project?.openCloud()} style={{ fontSize: 13, color: C.text, cursor: 'pointer', flex: '0 0 auto', textDecoration: 'underline' }}>Open</span>
      <span role="button" className="st-ghost" onClick={() => project?.newProject()} style={{ fontSize: 13, color: C.text, cursor: 'pointer', flex: '0 0 auto', textDecoration: 'underline' }}>New</span>
      <Dropdown trigger="click" position="br" getPopupContainer={(node) => node.closest(".studio") || document.body} droplist={(
        <Menu onClickMenuItem={(key) => project?.[key]()} style={{ minWidth: 200 }}>
          <Menu.Item key="openSettings">Project settings…</Menu.Item>
          <Menu.Item key="openSkills">Model skills…</Menu.Item>
          <Menu.Item key="openPrompts">Prompt templates…</Menu.Item>
        </Menu>
      )}>
        <span role="button" aria-label="Settings" title="Settings" className="st-ghost" style={{ display: 'inline-flex', fontSize: 16, color: C.text, cursor: 'pointer', flex: '0 0 auto' }}><IconSettings /></span>
      </Dropdown>
    </div>
  );
};

export default function FilmAgentPlayground({ active = true, project = null }) {
  const id = project?.id || null;
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [studio, setStudio] = useState(emptyStudio());
  const [view, setView] = useState('preview');
  const [focus, setFocus] = useState(null);
  const [commands, setCommands] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [answered, setAnswered] = useState(null);
  const nudge = useRef(() => {});

  const refresh = useCallback(async () => {
    const out = await tool('results', { project: id });
    setResults(out.results);
    setStudio(out.studio);
  }, [id]);

  // What the tab has read of this film. Another film starts over; leaving the tab only pauses it,
  // so coming back shows the film at once and picks up what changed.
  const seen = useRef({ after: 0, revision: null });
  useEffect(() => {
    seen.current = { after: 0, revision: null };
    setEvents([]);
    setResults([]);
    setStudio(emptyStudio());
    setBusy(false);
    setLoaded(false);
    setAnswered(null); // workbench ids start over in each film's session
  }, [id]);

  useEffect(() => {
    if (!id || !active) return undefined;
    let live = true;
    let sessionTimer = null;
    let filmTimer = null;
    const followSession = async () => {
      clearTimeout(sessionTimer);
      try {
        const res = await fetch(`/api/film/session?project=${encodeURIComponent(id)}&after=${seen.current.after}`);
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);
        if (!live) return;
        setBusy(out.busy);
        setCommands(out.commands || []);
        if (out.events.length) {
          seen.current.after = out.events[out.events.length - 1].n + 1;
          setEvents((x) => [...x, ...out.events]);
        }
      } catch (e) { if (live) Message.error({ content: e.message, id: 'film-session' }); }
      if (live) sessionTimer = setTimeout(followSession, SESSION_POLL_MS);
    };
    // Whoever changed the film, the agent or Studio, shows here.
    const followFilm = async () => {
      try {
        const moved = await (await fetch(`/api/film/cloud?action=studio&id=${encodeURIComponent(id)}${seen.current.revision ? `&since=${encodeURIComponent(seen.current.revision)}` : ''}`)).json();
        if (live && !moved.same && moved.revision) {
          seen.current.revision = moved.revision;
          await refresh();
        }
        if (live) setLoaded(true);
      } catch (e) { if (live) Message.error({ content: e.message, id: 'film-session' }); }
      if (live) filmTimer = setTimeout(followFilm, FILM_POLL_MS);
    };
    nudge.current = followSession;
    followSession();
    followFilm();
    return () => { live = false; nudge.current = () => {}; clearTimeout(sessionTimer); clearTimeout(filmTimer); };
  }, [id, refresh, active]);

  const say = async (text, attachments) => {
    setBusy(true);
    await postJson('/api/film/session', { action: 'say', project: id, name: project?.title || 'Untitled film', text, attachments });
    nudge.current();
  };
  const stop = () => postJson('/api/film/session', { action: 'stop', project: id }).catch((e) => Message.error(e.message));
  const onLabel = (name, change) => tool('label', { project: id, names: [name], ...change }).then(refresh).catch((e) => Message.error(e.message));
  const archive = (items, archived) => tool('archive', { project: id, ids: items.map((x) => x.vid), archived }).then(refresh).catch((e) => Message.error(e.message));
  // Deleted for good from the Library and the Asset Library. In the film, it leaves the unplaced pool;
  // a plate or take that was given a place stays, and you're told.
  const deleteAsset = async (it) => {
    try {
      const { report } = await deleteFromLibrary({ id: it.id, url: it.url, assetId: it.assetId, project: id });
      const { still_placed: placed } = await tool('forget_media', { project: id, url: it.url });
      await refresh();
      const failed = [report?.tos, report?.asset].filter((r) => /failed/.test(String(r)));
      if (failed.length) Message.error({ content: `Removed from the Library, but not fully deleted: ${failed.join('; ')}`, duration: 8000 });
      if (placed.length) Message.info({ content: `${placed.join(', ')} still ${placed.length === 1 ? 'uses' : 'use'} this file in the film.`, duration: 6000 });
    } catch (e) { Message.error(e.message); throw e; }
  };
  // A workbench the agent is waiting on takes over the right side until you use it or cancel; the
  // session does the work.
  const done = new Set(events.filter((e) => e.type === 'workbench_done').map((e) => e.id));
  const asked = [...events].reverse().find((e) => e.type === 'workbench' && !done.has(e.id));
  const open = asked && asked.id !== answered ? asked : null;
  const workbench = open ? results.find((r) => r.name === open.name) || null : null;
  const answer = async (fields) => {
    await postJson('/api/film/session', { action: 'answer', project: id, id: open.id, ...fields });
    setAnswered(open.id);
    setView('preview');
    nudge.current();
  };
  const useEdit = ({ words, marked }) => answer({ words, marked, name: workbench.name, mention: workbench.mention || workbench.name });
  const cancelEdit = () => answer({ cancelled: true }).catch((e) => Message.error(e.message));
  const [library, setLibrary] = useState([]);
  const loadLibrary = () => { if (id) listLibrary(id).then(setLibrary); };
  const useLibraryItem = async (it) => {
    const out = await tool('use_from_library', { project: id, id: it.id });
    await refresh();
    return out.name;
  };
  const show = (name) => { setFocus({ name, at: Date.now() }); setView('preview'); };
  const running = results.filter((r) => r.status === 'running');

  return (
    <div className="studio" style={{ position: 'relative', height: 'calc(100vh - 84px)', background: C.bg, border: '1px solid #000', borderRadius: 14, overflow: 'hidden', color: C.ink, textAlign: 'left' }}>
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />
      <div style={{ display: 'grid', gridTemplateColumns: `minmax(340px, ${SESSION_WIDTH}px) minmax(0, 1fr)`, height: '100%' }}>
        <div style={{ borderRight: `1px solid ${C.line}`, minHeight: 0 }}>
          <Session events={events} busy={busy} say={say} stop={stop} running={running} results={results} commands={commands} library={library} onBrowse={loadLibrary} onUseLibrary={useLibraryItem} onShowResult={show} onShowRunning={() => setView('generations')} head={<Head project={project} />} />
        </div>
        <div style={{ minHeight: 0, minWidth: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div style={{ display: 'flex', gap: 4, padding: '10px 16px', borderBottom: `1px solid ${C.line}` }}>
            {VIEWS.map(([k, label]) => (
              <span key={k} role="button" className="st-stage" onClick={() => { if (workbench) cancelEdit(); setView(k); }} style={{ padding: '6px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: !workbench && view === k ? C.ink : C.text, background: !workbench && view === k ? C.hover : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                {label}{k === 'generations' && running.length > 0 && <span className="st-pulse" style={{ fontFamily: MONO, fontSize: 12.5, color: C.work }}>{running.length}</span>}
              </span>
            ))}
          </div>
          <div style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'grid' }}>
            {workbench && <EditImage key={open.id} result={workbench} words={open.words} onCancel={cancelEdit} onUse={useEdit} />}
            {!workbench && view === 'preview' && <Preview results={results} onLabel={onLabel} focus={focus} loading={!!id && !loaded} />}
            {!workbench && view === 'generations' && <GenerationsView s={studio} archive={archive} open={(ref, vid) => { const r = results.find((x) => x.id === vid); if (r) show(r.name); }} />}
            {!workbench && view === 'library' && <Library project={id} version={results.length} onDelete={deleteAsset} />}
          </div>
        </div>
      </div>
    </div>
  );
}
