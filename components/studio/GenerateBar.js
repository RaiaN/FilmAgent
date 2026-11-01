import { useRef, useState } from 'react';
import { Button, Dropdown, Input, InputNumber, Menu } from '@arco-design/web-react';
import { IconClose, IconDown, IconPlus, IconSound, IconMute, IconUp, IconPlayArrowFill, IconLoading } from '@arco-design/web-react/icon';
import RefDrawer from '../film/canvas/RefDrawer';
import { matchMentions, mentionAt, putMention } from '../film/Session';
import { C, MONO, mediaOf } from './ui';
import { pad2, shotNumber, findShot, VIDEO_MODELS, STYLES, allVersions } from '../../utils/film/studio/model';
import { ASSET_GROUPS, filmAssets, resolveMention } from '../../utils/film/studio/assets';
import { MAX_TAKES, MIN_SECONDS, RATIOS, barSummary } from '../../utils/film/studio/bar';
import { videoTraits } from '../../utils/film/suiteConfig';

// THE GENERATE BAR — the big control: references, the film's look and the prompt, then the render's
// settings and Generate. Docked under every page; it fills in from the shot you are on.
const DRAWER_TABS = [{ key: 'all', label: 'All' }, ...ASSET_GROUPS.map((g) => ({ key: g.key, label: g.label }))];

const Card = ({ label, value, onClick, active, children }) => (
  <div role="button" className="st-chip" onClick={onClick} style={{ flex: '1 1 0', minWidth: 0, height: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${active ? C.lineHi : 'transparent'}`, background: C.raised }}>
    {children}
    <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 16, color: value === 'Auto' ? C.text : C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  </div>
);
const Pill = ({ children, ...rest }) => <span {...rest} style={{ height: 40, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px', borderRadius: 12, background: C.raised, color: C.ink, fontSize: 14.5, whiteSpace: 'nowrap', cursor: rest.onClick ? 'pointer' : 'default', flex: '0 0 auto', ...rest.style }}>{children}</span>;

export const GenerateBar = ({ s, bar, setBar, onGenerate, busy, container, setStyle, open, setOpen }) => {
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [active, setActive] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const area = useRef(null);
  const patch = (fields) => setBar((b) => ({ ...b, ...fields }));
  const assets = filmAssets(s).filter((a) => a.status !== 'running' && a.status !== 'failed' && a.status !== 'rejected');
  const traits = videoTraits(bar.model);
  const shot = bar.shotId ? findShot(s, bar.sceneId, bar.shotId) : null;
  const mention = closed ? null : mentionAt(bar.text, caret);
  const options = mention ? matchMentions(assets, mention.query) : [];
  const thumbOf = (word) => {
    const name = resolveMention(s, word).name || String(word).toUpperCase();
    const hit = allVersions(s).find((x) => x.v.name === name);
    return hit ? hit.v.posterUrl || mediaOf(hit.v) : '';
  };
  const choose = (o) => {
    const out = putMention(bar.text, mention, caret, o.mention || o.name);
    patch({ text: out.text });
    setCaret(out.caret);
    setActive(0);
  };
  const onKeys = (e) => {
    if (options.length && e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
    if (options.length && e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
    if (options.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); choose(options[Math.min(active, options.length - 1)]); return; }
    if (options.length && e.key === 'Escape') { e.preventDefault(); setClosed(true); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onGenerate(); }
  };
  const drawerItems = assets.map((a) => ({ id: a.id, url: a.poster || (a.type === 'image' ? a.url : ''), label: `${a.name} · ${a.title}`, bucket: a.group, kind: a.type, tile: true, mention: a.mention || a.name }));
  const on = new Set(bar.refs.map((r) => String(r).toLowerCase()));
  const selection = new Map(drawerItems.filter((it) => on.has(it.mention.toLowerCase())).map((it) => [it.id, '✓']));
  const toggleRef = (it) => patch({ refs: on.has(it.mention.toLowerCase()) ? bar.refs.filter((r) => String(r).toLowerCase() !== it.mention.toLowerCase()) : [...bar.refs, it.mention] });
  const popup = () => container() || document.body;
  const editing = !!bar.source;
  const ready = !!String(bar.text).trim() && !busy;
  // Said only when the page doesn't already say it.
  const inScene = shot ? s.scenes.find((sc) => sc.id === bar.sceneId) : null;
  const targetLabel = editing ? `Editing ${bar.source}` : !shot ? 'Not on a shot: lands in Generations' : inScene?.shots.length > 1 ? `Shot ${pad2(shotNumber(s, shot.id))}` : '';
  return (
    <div style={{ background: C.panel, borderTop: `1px solid ${C.line}`, padding: '8px 14px 10px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        {(targetLabel || bar.parent) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 22 }}>
            <span style={{ fontSize: 14, color: shot || editing ? C.accent : C.muted, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targetLabel}</span>
            {bar.parent && <span style={{ fontSize: 13, color: C.muted, flex: '0 0 auto' }}>Reworks {bar.parent}</span>}
            {(editing || bar.parent) && <span role="button" aria-label="Back to a new take" title="Back to a new take" onClick={() => patch({ source: null, parent: null })} style={{ color: C.muted, cursor: 'pointer', display: 'inline-flex' }}><IconClose /></span>}
          </div>
        )}
        {open && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Card label="References" value={`${bar.refs.length}/${traits.refCap}`} onClick={() => setBrowsing(true)}>
              {bar.refs.length > 0
                ? <span style={{ display: 'flex', flex: '0 0 auto' }}>{bar.refs.slice(0, 3).map((r, i) => <img key={r} src={thumbOf(r)} alt="" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover', marginLeft: i ? -14 : 0, boxShadow: `0 0 0 2px ${C.raised}`, background: '#08090b' }} />)}</span>
                : <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: C.bg, color: C.text, flex: '0 0 auto' }}><IconPlus /></span>}
            </Card>
            <Dropdown trigger="click" getPopupContainer={popup} droplist={<Menu style={{ maxHeight: 320, overflowY: 'auto' }} onClickMenuItem={(k) => setStyle(k === '_auto' ? '' : k)}><Menu.Item key="_auto">From the script</Menu.Item>{STYLES.map((x) => <Menu.Item key={x}>{x}</Menu.Item>)}</Menu>}>
              <span style={{ flex: '1 1 0', minWidth: 0, display: 'flex' }}><Card label="Film look" value={s.style || 'From the script'} /></span>
            </Dropdown>
          </div>
        )}
        <div style={{ position: 'relative', display: 'flex', gap: 12, alignItems: 'stretch', background: C.raised, borderRadius: 20, padding: 12 }}>
          {options.length > 0 && (
            <div style={{ position: 'absolute', left: 12, bottom: '100%', marginBottom: 6, width: 380, maxHeight: 320, overflowY: 'auto', zIndex: 6, background: C.panel, border: `1px solid ${C.lineHi}`, borderRadius: 12, padding: 4 }}>
              {options.map((o, i) => (
                <div key={o.id} role="button" onMouseDown={(e) => { e.preventDefault(); choose(o); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: i === active ? C.hover : 'transparent' }}>
                  <span style={{ width: 40, height: 30, borderRadius: 5, overflow: 'hidden', background: '#08090b', flex: '0 0 auto' }}>{(o.poster || o.type === 'image') && <img src={o.poster || o.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: C.accent, flex: '0 0 auto' }}>{o.name}</span>
                  <span style={{ fontSize: 13.5, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, alignContent: 'space-between' }}>
            <Input.TextArea ref={area} className="st-bare" aria-label="Describe the shot" value={bar.text} onFocus={() => setOpen(true)} onChange={(v, e) => { patch({ text: v }); setCaret(e?.target?.selectionStart ?? v.length); setClosed(false); setActive(0); }} onKeyDown={onKeys} onKeyUp={(e) => setCaret(e.target.selectionStart)} onClick={(e) => setCaret(e.target.selectionStart)} autoSize={{ minRows: open ? 2 : 1, maxRows: open ? 5 : 1 }} placeholder="Describe the shot, @ to add cast, places and takes" style={{ fontSize: 17, lineHeight: 1.5, color: C.ink }} />
            {open && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Dropdown trigger="click" getPopupContainer={popup} droplist={<Menu onClickMenuItem={(k) => patch({ model: k, seconds: Math.min(bar.seconds, videoTraits(k).maxSeconds) })}>{VIDEO_MODELS.map((m) => <Menu.Item key={m.key}>{m.label}</Menu.Item>)}</Menu>}><Pill onClick={() => {}} style={{ background: C.bg }}>{VIDEO_MODELS.find((m) => m.key === bar.model)?.label || bar.model}<IconDown style={{ fontSize: 12, color: C.muted }} /></Pill></Dropdown>
                {!editing && <Dropdown trigger="click" getPopupContainer={popup} droplist={<Menu onClickMenuItem={(k) => patch({ quality: k })}><Menu.Item key="draft">Draft · 480p</Menu.Item><Menu.Item key="final">Final · 1080p MOV</Menu.Item></Menu>}><Pill onClick={() => {}} style={{ background: C.bg }}>{bar.quality === 'draft' ? '480p draft' : '1080p'}</Pill></Dropdown>}
                {!editing && <Dropdown trigger="click" getPopupContainer={popup} droplist={<Menu onClickMenuItem={(k) => patch({ ratio: k })}>{RATIOS.map((r) => <Menu.Item key={r}>{r}</Menu.Item>)}</Menu>}><Pill onClick={() => {}} style={{ background: C.bg }}>{bar.ratio}</Pill></Dropdown>}
                {!editing && <Pill style={{ background: C.bg, padding: '0 6px 0 13px' }}>Seconds<InputNumber aria-label="Seconds" size="small" min={MIN_SECONDS} max={traits.maxSeconds} value={bar.seconds} onChange={(v) => patch({ seconds: v || MIN_SECONDS })} style={{ width: 76 }} /></Pill>}
                {!editing && <Pill role="button" aria-label="Sound" aria-pressed={bar.audio} onClick={() => patch({ audio: !bar.audio })} style={{ background: C.bg }}>{bar.audio ? <IconSound /> : <IconMute />}{bar.audio ? 'On' : 'Off'}</Pill>}
                {!editing && <Pill style={{ background: C.bg, padding: '0 4px' }}><Button type="text" size="small" aria-label="Fewer takes" disabled={bar.count <= 1} onClick={() => patch({ count: bar.count - 1 })}>−</Button><span style={{ fontFamily: MONO }}>{bar.count}/{MAX_TAKES}</span><Button type="text" size="small" aria-label="More takes" disabled={bar.count >= MAX_TAKES} onClick={() => patch({ count: bar.count + 1 })}>+</Button></Pill>}
              </div>
            )}
          </div>
          <span role="button" className="st-chip" aria-label={open ? 'Fewer controls' : 'More controls'} title={open ? 'Fewer controls' : 'More controls'} onClick={() => setOpen((o) => !o)} style={{ alignSelf: 'center', width: 40, height: 40, borderRadius: 12, border: `1px solid ${C.lineHi}`, background: C.hover, color: C.ink, fontSize: 18, cursor: 'pointer', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>{open ? <IconDown /> : <IconUp />}</span>
          <button type="button" className="st-generate" aria-label="Generate" disabled={!ready} onClick={onGenerate} style={{ flex: '0 0 auto', width: open ? 200 : 150, border: 'none', borderRadius: 16, background: ready ? C.gold : C.hover, color: ready ? C.accentInk : C.muted, cursor: ready ? 'pointer' : 'default', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 4, padding: '10px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.2, display: 'inline-flex', alignItems: 'center', gap: 7 }}>{busy ? <IconLoading /> : <IconPlayArrowFill />}{editing ? 'Edit' : 'Generate'}</span>
            <span style={{ fontSize: 12.5, opacity: 0.8 }}>{barSummary(bar)}</span>
          </button>
        </div>
      </div>
      {browsing && <RefDrawer dark width={520} title="References" hint="Click to use it in this shot. Click again to take it out." items={drawerItems} tabs={DRAWER_TABS} selection={selection} onToggle={toggleRef} onClose={() => setBrowsing(false)} />}
    </div>
  );
};
