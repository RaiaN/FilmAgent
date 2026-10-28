import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { IconCheck, IconClose, IconStarFill, IconPlayArrowFill } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Tile, Empty, Label, Avatar, Dot, CanvasButton, crewColor, crewWho, mediaOf, isVideo } from './ui';
import { containerOf, findShot, namedText, pickedOf, pad2, shotNumber, videoModelLabel } from '../../utils/film/studio/model';
import { DRAFT_MODE, draftFinalsOf } from '../../utils/film/suiteConfig';
import { containerLabel } from '../../utils/film/studio/runners';
import { InputsPanel, RefsEditor } from './Refs';
import { Stripboard } from './Stripboard';

// DAILIES — the whole film under review: every element, shot and cut with all its versions.
// "Needs you" narrows it to what waits on the director (call sheets, questions, new work,
// stale shots); a scene plays its circled takes back to back.
const TEXT_KINDS = ['script', 'scriptBreakdown', 'breakdown'];
const BRIEF_KINDS = [['script', 'Script'], ['scriptBreakdown', 'Script breakdown'], ['breakdown', 'Scene sheets']];
const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const isNew = (c) => (c?.versions || []).some((v) => v.status === 'review');
const shown = (c) => (c?.versions || []).filter((v) => v.status !== 'rejected');

const Section = ({ title, n, color, children }) => (n ? (
  <div style={{ display: 'grid', gap: 2 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', padding: '14px 8px 6px' }}>{color && <Dot color={color} />}<span style={ellipsis}>{title}</span><span style={{ marginLeft: 'auto', fontFamily: MONO, letterSpacing: 0 }}>{n}</span></div>
    {children}
  </div>
) : null);
const Row = ({ on, onClick, children, sub }) => (
  <div role="button" className={on ? undefined : 'st-row'} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: sub ? '5px 8px 5px 14px' : '7px 8px', borderRadius: 8, cursor: 'pointer', background: on ? C.hover : 'transparent', boxShadow: on ? `inset 2px 0 0 ${C.accent}` : 'none', color: C.ink, fontSize: 13 }}>{children}</div>
);
const Count = ({ c }) => {
  const n = shown(c).length;
  return (
    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontFamily: MONO }}>
      {isNew(c) && <Dot color={C.warn} />}{(c?.versions || []).some((v) => v.status === 'running') && <Dot color={C.work} pulse />}{n || ''}
    </span>
  );
};

// The left column: the whole film, or only what needs you.
export const Queue = ({ s, q, sel, setSel, filter, setFilter }) => {
  const same = (ref) => !sel?.vid && sel?.ref && JSON.stringify(sel.ref) === JSON.stringify(ref);
  return (
    <div style={{ overflowY: 'auto', padding: '10px 10px 16px', borderRight: `1px solid ${C.line}`, background: C.panel }}>
      <div style={{ display: 'flex', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 9, padding: 3, marginBottom: 4 }}>
        {[['all', 'Everything'], ['needs', `Needs you${q.waiting ? ` · ${q.waiting}` : ''}`]].map(([k, l]) => (
          <span key={k} role="button" onClick={() => setFilter(k)} style={{ flex: 1, textAlign: 'center', padding: '4px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: filter === k ? C.hover : 'transparent', color: filter === k ? (k === 'needs' && q.waiting ? C.warn : C.ink) : C.muted }}>{l}</span>
        ))}
      </div>
      {filter === 'needs' ? (
        <>
          {!q.waiting && <Empty>Nothing waiting on you</Empty>}
          <Section title="Approve" n={q.approvals.length} color={C.accent}>
            {q.approvals.map((sh) => <Row key={sh.id} on={sel?.sheet === sh.id} onClick={() => setSel({ sheet: sh.id })}><Avatar id={sh.req.agent} size={22} /><span style={ellipsis}>{sh.summary}</span></Row>)}
          </Section>
          <Section title="Questions" n={q.questions.length} color={C.warn}>
            {q.questions.map(({ key, m }) => <Row key={m.id} on={sel?.question === m.id} onClick={() => setSel({ question: m.id, key })}><Avatar id={m.from} size={22} /><span style={ellipsis}>{m.text}</span></Row>)}
          </Section>
          <Section title="New" n={q.deliveries.length} color={C.good}>
            {q.deliveries.map(({ ref, v, label }) => (
              <Row key={v.id} on={sel?.vid === v.id} onClick={() => setSel({ ref, vid: v.id })}>
                {TEXT_KINDS.includes(v.kind) ? <Avatar id={v.by} size={22} /> : <Tile v={v} w={v.kind === 'plate' ? 30 : 52} ratio={v.kind === 'plate' ? '1' : '16 / 9'} />}
                <span style={ellipsis}>{TEXT_KINDS.includes(v.kind) ? (v.kind === 'breakdown' ? 'Scene sheets' : v.kind === 'scriptBreakdown' ? 'Script breakdown' : 'Script') : label}</span>
              </Row>
            ))}
          </Section>
          <Section title="Stale" n={q.stale.length} color={C.warn}>
            {q.stale.map(({ sc, sh, who }) => <Row key={sh.id} on={sel?.stale === sh.id} onClick={() => setSel({ stale: sh.id, sceneId: sc.id })}><span style={{ fontFamily: MONO, color: C.accent, fontWeight: 700, fontSize: 12 }}>{pad2(shotNumber(s, sh.id))}</span><span style={ellipsis}>{sh.title}</span><span style={{ marginLeft: 'auto', fontSize: 11, color: C.warn }}>{who.join(', ')}</span></Row>)}
          </Section>
        </>
      ) : (
        <>
          {(s.brief.versions || []).length > 0 && (
            <Section title="Brief" n={shown(s.brief).length}>
              {BRIEF_KINDS.filter(([k]) => s.brief.versions.some((v) => v.kind === k)).map(([k, label]) => (
                <Row key={k} on={sel?.ref?.at === 'brief' && sel.kind === k && !sel.vid} onClick={() => setSel({ ref: { at: 'brief' }, kind: k })}>
                  <span style={ellipsis}>{label}</span><Count c={{ versions: s.brief.versions.filter((v) => v.kind === k) }} />
                </Row>
              ))}
            </Section>
          )}
          <Section title="Cast & World" n={s.elements.length}>
            {s.elements.map((el) => {
              const ref = { at: 'element', id: el.id };
              return <Row key={el.id} on={same(ref)} onClick={() => setSel({ ref })}><Tile v={pickedOf(el)} w={26} ratio="1" /><span style={ellipsis}>{el.name}</span><Count c={el} /></Row>;
            })}
          </Section>
          {s.scenes.map((sc, i) => (
            <Section key={sc.id} title={`${pad2(i + 1)} ${sc.title}`} n={sc.shots.length}>
              <Row on={sel?.scene === sc.id} onClick={() => setSel({ scene: sc.id })}><IconPlayArrowFill style={{ color: C.accent }} /><span>Play the scene</span></Row>
              {sc.shots.map((sh) => {
                const ref = { at: 'take', sceneId: sc.id, shotId: sh.id };
                return (
                  <div key={sh.id}>
                    <Row sub on={same(ref)} onClick={() => setSel({ ref })}>
                      <span style={{ fontFamily: MONO, color: C.accent, fontWeight: 700, fontSize: 11.5 }}>{pad2(shotNumber(s, sh.id))}</span><span style={ellipsis}>{sh.title}</span><Count c={sh.takes} />
                    </Row>
                  </div>
                );
              })}
            </Section>
          ))}
          {(s.cut.versions || []).length > 0 && (
            <Section title="Cut" n={shown(s.cut).length}>
              <Row on={same({ at: 'cut' })} onClick={() => setSel({ ref: { at: 'cut' } })}><span>Cut</span><Count c={s.cut} /></Row>
            </Section>
          )}
        </>
      )}
    </div>
  );
};

// One scene sheet, as the 1st AD blocked it.
const SceneSheet = ({ x }) => {
  const sh = x.sheet;
  const row = (k, val) => (val ? <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 10, fontSize: 12.5, lineHeight: 1.55 }}><span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text }}>{val}</span></div> : null);
  return (
    <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
      {row('Landmarks', sh.landmarks)}
      {sh.views.map((vw, i) => <div key={i}>{row(i ? '' : 'Views', <><b style={{ color: C.ink, fontWeight: 600 }}>{vw.name}</b> — {vw.from}</>)}</div>)}
      {row('Start', x.startFrom === 'previous' ? 'On the last frame of the scene before' : sh.start)}
      {sh.beats.map((b, i) => <div key={i}>{row(i ? '' : 'Beats', <><span style={{ fontFamily: MONO, color: C.accent }}>{b.view}</span> · {b.action} <span style={{ color: C.muted }}>Eyes on:</span> {b.looksAt}</>)}</div>)}
      {row('Against', sh.against)}
      {row('Sound', x.audio)}
      {row('End', sh.end)}
    </div>
  );
};

// A version shown big: a take or cut plays (and tells the note its time), a plate or frame
// shows, text reads.
const Big = ({ v, onTime }) => {
  const ref = useRef(null);
  if (!v) return null;
  if (v.kind === 'script') return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: SCRIPT_FONT, fontSize: 13.5, lineHeight: 1.7, margin: 0, padding: '32px 40px', background: C.page, color: '#e9e4da', border: `1px solid ${C.line}`, borderRadius: 12, maxHeight: 560, overflow: 'auto' }}>{v.text}</pre>;
  if (v.kind === 'scriptBreakdown') return v.payload ? <Stripboard b={v.payload} /> : null;
  if (v.kind === 'breakdown') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {(v.payload?.scenes || []).map((sc, i) => (
          <div key={i}>
            <Label>{String(sc.title || '')}</Label>
            {sc.shots.map((x, j) => (
              <div key={j} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.line}` }}>
                <div><div style={{ fontWeight: 600, fontSize: 13.5, color: C.ink }}>{x.title}</div><div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55, marginTop: 2, fontStyle: x.sheet ? 'italic' : 'normal' }}>{x.quote}</div>{x.sheet && <SceneSheet x={x} />}</div>
                <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{x.seconds}s</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (v.status === 'running') return <div style={{ aspectRatio: '16 / 9', background: '#050607', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.work }}><span className="st-pulse">Working…</span></div>;
  if (v.status === 'failed') return <div style={{ aspectRatio: '16 / 9', background: '#1a0f10', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.bad, padding: 24, textAlign: 'center' }}>{v.error || 'Failed'}</div>;
  if (isVideo(v)) return <video ref={ref} key={mediaOf(v)} src={mediaOf(v)} controls onTimeUpdate={() => onTime && onTime(ref.current?.currentTime || 0)} onPause={() => onTime && onTime(ref.current?.currentTime || 0)} style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 12, display: 'block' }} />;
  return <img src={mediaOf(v)} alt="" style={{ width: '100%', maxHeight: 520, objectFit: 'contain', background: '#050607', borderRadius: 12, display: 'block' }} />;
};

const Flags = ({ v }) => ((v?.flags || []).length ? (
  <div style={{ display: 'grid', gap: 3 }}>
    {v.flags.map((f, i) => <div key={i} style={{ fontSize: 12.5, color: f.warn ? C.warn : C.good }}>{f.warn ? '!' : <IconCheck />} {f.text}</div>)}
  </div>
) : null);

const STATUS = { review: ['new', C.warn], picked: ['★', C.gold], running: ['working', C.work], failed: ['failed', C.bad], rejected: ['rejected', C.muted] };
// Every version of the container, oldest → newest; the one on screen outlined.
const Versions = ({ c, vid, onSelect, kind }) => {
  const textual = TEXT_KINDS.includes(kind);
  const list = (c?.versions || []).filter((v) => !textual || v.kind === kind);
  if (list.length < 2) return null;
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {list.map((v, i) => {
        const [word, color] = STATUS[v.status] || ['', C.muted];
        return (
          <div key={v.id} role="button" onClick={() => onSelect(v.id)} style={{ display: 'grid', gap: 4, justifyItems: 'center', cursor: 'pointer', opacity: v.status === 'rejected' ? 0.4 : 1 }}>
            {textual
              ? <span style={{ width: 64, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 12, background: C.raised, boxShadow: v.id === vid ? `0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.line}`, color: C.ink }}>v{i + 1}</span>
              : <span style={{ borderRadius: 7, boxShadow: v.id === vid ? `0 0 0 2px ${C.accent}` : 'none' }}><Tile v={v} w={v.kind === 'plate' ? 56 : 92} ratio={v.kind === 'plate' ? '1' : '16 / 9'} picked={v.status === 'picked'} /></span>}
            <span style={{ fontSize: 10, fontWeight: 600, color }}>{word || `v${i + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
};

const VersionDetail = ({ s, set, toast, ref_, v, onPick, onNote, onFinal, onReject, onSelect, canvas }) => {
  const [note, setNote] = useState('');
  const [time, setTime] = useState(null);
  const [anchor, setAnchor] = useState(false);
  useEffect(() => { setNote(''); setAnchor(false); setTime(null); }, [v.id]);
  const c = containerOf(s, ref_);
  const current = ref_.at !== 'brief' ? pickedOf(c) : null;
  const compare = current && current.id !== v.id && current.status !== 'running' && v.status !== 'running' && v.status !== 'failed' ? current : null;
  const shot = ref_.shotId ? findShot(s, ref_.sceneId, ref_.shotId) : null;
  const noteable = ref_.at !== 'cut';
  const pickLabel = ref_.at === 'take' ? 'Circle' : 'Pick';
  const noteTo = v.by === 'you' ? 'VFX' : v.by === 'board' ? 'Camera' : crewWho(v.by);
  // A draft finishes as the same picture in MOV, on the model that drafted it, at a resolution
  // that model offers (2.5: 1080p · Premium: 1080p or 4K), within the draft's 7 days.
  const finishable = ref_.at === 'take' && v.draft?.taskId && v.status !== 'running' && v.status !== 'failed';
  const finalsOf = finishable ? c.versions.filter((x) => x.final && x.parent === v.id && x.status !== 'failed') : [];
  const expired = finishable && Date.now() - v.draft.at >= DRAFT_MODE.ttlMs;
  const finalRes = finishable ? draftFinalsOf(v.draft.modelKey || 'seedance25') : [];
  const send = () => {
    const t = note.trim();
    if (!t) return;
    onNote(anchor && time != null ? `At ${time.toFixed(1)} s: ${t}` : t);
    setNote('');
  };
  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>{containerLabel(s, ref_)}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted }}><Avatar id={v.by} size={20} /><span style={{ color: crewColor(v.by) }}>{crewWho(v.by)}</span>{v.res ? ` · ${v.res}` : ''}{v.format === 'mov' ? ' · MOV' : ''}</span>
        <span style={{ flex: 1 }} />
        {v.parent && v.note && <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>“{v.note}”</span>}
        {canvas && !TEXT_KINDS.includes(v.kind) && mediaOf(v) && <CanvasButton onClick={() => canvas.version(ref_, v, containerLabel(s, ref_))} />}
      </div>
      {compare ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><Label>{ref_.at === 'take' ? 'Circled' : 'Picked'}</Label><Big v={compare} /></div>
          <div><Label><span style={{ color: C.accent }}>This version</span></Label><Big v={v} onTime={setTime} /></div>
        </div>
      ) : <Big v={v} onTime={setTime} />}
      <Versions c={c} vid={v.id} kind={v.kind} onSelect={onSelect} />
      {shot && <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>{namedText(s, shot.motion) || shot.quote}</div>}
      <Flags v={v} />
      <InputsPanel s={s} v={v} />
      {shot && set && <RefsEditor s={s} set={set} sceneId={ref_.sceneId} shotId={ref_.shotId} toast={toast} />}
      {v.status !== 'running' && v.status !== 'failed' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: 8 }}>
          {v.status !== 'picked' ? <Button type="primary" icon={<IconStarFill />} onClick={onPick}>{pickLabel}</Button> : <span style={{ color: C.gold, fontWeight: 700, fontSize: 13, padding: '0 8px' }}>★ {ref_.at === 'take' ? 'Circled' : 'Picked'}</span>}
          {noteable && (
            <>
              {isVideo(v) && time != null && <Button size="small" type={anchor ? 'primary' : 'secondary'} onClick={() => setAnchor((a) => !a)}>at {time.toFixed(1)} s</Button>}
              <Input className="st-bare" value={note} onChange={setNote} onPressEnter={send} placeholder={`Note to ${noteTo}`} style={{ flex: 1 }} />
              <Button disabled={!note.trim()} onClick={send}>Send note</Button>
            </>
          )}
          {!noteable && <span style={{ flex: 1 }} />}
          {finalRes.map((res) => <Button key={res} onClick={() => onFinal(res)} disabled={expired} title={expired ? 'Drafts finish within 7 days — draft the shot again' : `The same picture at ${res} MOV · ${videoModelLabel(v.draft.modelKey || 'seedance25')}`}>{finalsOf.length ? 'Final again' : 'Final'} · {res}</Button>)}
          {v.status !== 'rejected' && <Button icon={<IconClose />} status="danger" onClick={onReject} title="Reject" aria-label="Reject" />}
        </div>
      )}
    </div>
  );
};

// A scene's circled takes, back to back — the scene as it stands.
const ScenePlay = ({ s, sceneId, open }) => {
  const sc = s.scenes.find((x) => x.id === sceneId);
  const [i, setI] = useState(0);
  const vid = useRef(null);
  const reel = (sc?.shots || []).map((sh) => ({ sh, t: pickedOf(sh.takes) })).filter((x) => x.t && mediaOf(x.t) && x.t.status !== 'running');
  useEffect(() => { setI(0); }, [sceneId]);
  useEffect(() => { if (i > 0) vid.current?.play().catch(() => {}); }, [i]);
  if (!sc) return <Empty>Gone.</Empty>;
  const cur = reel[i];
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>{sc.title}</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>{reel.length} of {sc.shots.length} circled{cur ? ` · ${pad2(shotNumber(s, cur.sh.id))} ${cur.sh.title}` : ''}</span>
      </div>
      {cur
        ? <video ref={vid} key={mediaOf(cur.t)} src={mediaOf(cur.t)} controls onEnded={() => setI((n) => (n + 1 < reel.length ? n + 1 : n))} style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 12, display: 'block' }} />
        : <div style={{ aspectRatio: '16 / 9', maxHeight: 520, background: '#050607', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.muted }}>Nothing circled in this scene</div>}
      <div style={{ display: 'flex', gap: 4 }}>
        {sc.shots.map((sh) => {
          const k = reel.findIndex((x) => x.sh.id === sh.id);
          const on = k === i && k >= 0;
          return (
            <div key={sh.id} role="button" title={sh.title} onClick={() => (k >= 0 ? setI(k) : open({ type: 'shot', sceneId, id: sh.id }))} style={{ flex: `${Math.max(1, Number(sh.seconds) || 1)} 1 0`, minWidth: 44, height: 50, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', position: 'relative', boxShadow: on ? `0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.line}`, background: k >= 0 ? '#08090b' : C.warnSoft }}>
              {k >= 0 && reel[k].t.posterUrl && <img src={reel[k].t.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              <span style={{ position: 'absolute', left: 4, bottom: 3, fontFamily: MONO, fontSize: 10, fontWeight: 700, color: k >= 0 ? '#fff' : C.warn, textShadow: '0 1px 2px #000' }}>{pad2(shotNumber(s, sh.id))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// CASTING'S PROMPTS on its call sheet: every plate's words, editable until Approve — what is
// approved is what renders (the film's style, and the portrait spec for faces, ride along).
const CAST_FIELDS = (c) => {
  const type = String(c?.type || c?.role || '').toLowerCase();
  const has = (k) => String(c?.[k] || '').trim();
  if (type === 'character' && has('facePrompt')) return [['facePrompt', 'Face'], ...(has('bodyPrompt') ? [['bodyPrompt', 'Body']] : [])];
  const key = ['presencePrompt', 'prompt', 'facePrompt'].find(has) || 'prompt';
  return [[key, type === 'creature' ? 'Presence' : 'Plate']];
};
const PromptField = ({ value, onCommit }) => {
  const [v, setV] = useState(null);
  return <Input.TextArea value={v !== null ? v : value} onChange={setV} onFocus={() => setV(value)} onBlur={() => { if (v !== null && v !== value) onCommit(v); setV(null); }} autoSize={{ minRows: 2, maxRows: 8 }} style={{ fontSize: 12.5, lineHeight: 1.55 }} />;
};
const CastPrompts = ({ sh, set }) => {
  const patch = (i, key, text) => set((x) => ({ ...x, sheets: x.sheets.map((y) => (y.id !== sh.id ? y : { ...y, payload: { ...y.payload, arr: y.payload.arr.map((c, k) => (k === i ? { ...c, [key]: text } : c)) } })) }));
  return (
    <div style={{ display: 'grid', gap: 14, padding: '12px 16px', maxHeight: 560, overflowY: 'auto' }}>
      {sh.payload.arr.map((c, i) => (
        <div key={i} style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{c.name}</div>
          {CAST_FIELDS(c).map(([key, label]) => (
            <div key={key} style={{ display: 'grid', gap: 3 }}>
              <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
              <PromptField value={String(c[key] || '')} onCommit={(text) => patch(i, key, text)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const SheetDetail = ({ sh, set, approve, cancel }) => (
  <div style={{ display: 'grid', gap: 0, maxWidth: 720, border: `1px solid ${C.accent}`, borderRadius: 14, overflow: 'hidden', background: C.raised }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: C.accentSoft, borderBottom: `1px solid ${C.line}` }}>
      <Avatar id={sh.req.agent} size={28} />
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: C.accent }}>CALL SHEET</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: crewColor(sh.req.agent) }}>{crewWho(sh.req.agent)}</span>
    </div>
    {sh.req.agent === 'casting' && sh.req.action === 'cast' && sh.payload?.arr
      ? <CastPrompts sh={sh} set={set} />
      : <div style={{ display: 'grid', gap: 6, padding: '12px 16px' }}>
      {sh.jobs.map((j, i) => <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: C.ink }}><span style={{ flex: 1 }}>{j.label}</span><span style={{ color: C.muted, fontSize: 12.5 }}>{j.detail}</span></div>)}
    </div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: `1px solid ${C.line}` }}>
      <b style={{ flex: 1, fontWeight: 600, color: C.ink }}>{sh.summary}</b>
      <Button onClick={() => cancel(sh.id)}>Cancel</Button>
      <Button type="primary" onClick={() => approve(sh.id)}>Approve</Button>
    </div>
  </div>
);

// A container opened without a version shows the one that most needs eyes: new, else the
// pick, else the latest.
const focusOf = (c, kind = null) => {
  const list = (c?.versions || []).filter((v) => !kind || v.kind === kind);
  return list.find((v) => v.status === 'review') || (kind ? list.find((v) => v.status === 'picked') : pickedOf(c)) || list[list.length - 1] || null;
};

export const Detail = ({ s, set, toast, sel, setSel, q, onPick, onNote, onFinal, onReject, approve, cancel, answer, keepStale, redoStale, open, canvas }) => {
  if (!sel) {
    const next = q.approvals[0] ? { sheet: q.approvals[0].id } : q.questions[0] ? { question: q.questions[0].m.id, key: q.questions[0].key } : q.deliveries[0] ? { ref: q.deliveries[0].ref, vid: q.deliveries[0].v.id } : null;
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 300 }}>{next ? <Button type="primary" size="large" onClick={() => setSel(next)}>Start with what needs you</Button> : <span style={{ color: C.muted, fontSize: 14 }}>Pick anything on the left</span>}</div>;
  }
  if (sel.scene) return <ScenePlay s={s} sceneId={sel.scene} open={open} />;
  if (sel.sheet) {
    const sh = s.sheets.find((x) => x.id === sel.sheet);
    return sh && sh.status === 'pending' ? <SheetDetail sh={sh} set={set} approve={approve} cancel={cancel} /> : <Empty>Done.</Empty>;
  }
  if (sel.question) {
    const m = (s.threads[sel.key] || []).find((x) => x.id === sel.question);
    if (!m || m.answered) return <Empty>Answered.</Empty>;
    return (
      <div style={{ display: 'grid', gap: 14, maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar id={m.from} size={28} /><span style={{ fontSize: 14, fontWeight: 600, color: crewColor(m.from) }}>{crewWho(m.from)}</span></div>
        <div style={{ fontSize: 18, color: C.ink, lineHeight: 1.5 }}>{m.text}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(m.options || []).map((o, i) => <Button key={i} type={i === 0 ? 'primary' : 'secondary'} onClick={() => answer(sel.key, m, o)}>{o.label}</Button>)}</div>
      </div>
    );
  }
  if (sel.stale) {
    const sh = findShot(s, sel.sceneId, sel.stale);
    const item = q.stale.find((x) => x.sh.id === sel.stale);
    if (!sh || !item) return <Empty>Up to date.</Empty>;
    const t = pickedOf(sh.takes);
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.ink }}><span style={{ fontFamily: MONO, color: C.accent, marginRight: 10 }}>{pad2(shotNumber(s, sh.id))}</span>{sh.title}</div>
        <div style={{ fontSize: 13, color: C.warn }}>Made with an earlier {item.who.join(', ')}</div>
        <Big v={t} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="primary" onClick={() => redoStale(sel.sceneId, sh.id)}>Shoot again</Button>
          <Button onClick={() => keepStale(sel.sceneId, sh.id)}>Keep this take</Button>
          <span style={{ flex: 1 }} />
          <Button type="text" onClick={() => open({ type: 'shot', sceneId: sel.sceneId, id: sh.id })}>Open the scene</Button>
        </div>
      </div>
    );
  }
  const c = containerOf(s, sel.ref);
  const v = sel.vid ? (c?.versions || []).find((x) => x.id === sel.vid) : focusOf(c, sel.kind);
  if (!v) return <Empty>No versions yet</Empty>;
  return <VersionDetail s={s} set={set} toast={toast} ref_={sel.ref} v={v} canvas={canvas} onSelect={(vid) => setSel({ ref: sel.ref, vid })} onPick={() => onPick(sel.ref, v)} onNote={(t) => onNote(sel.ref, v, t)} onFinal={(res) => onFinal(sel.ref, v, res)} onReject={() => onReject(sel.ref, v)} />;
};
