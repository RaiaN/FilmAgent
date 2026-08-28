import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Typography } from '@arco-design/web-react';

const { Text } = Typography;

// Large, focused editor for a SHOT card's cinematic prompt, with @-mention reference
// tagging. Type "@" to pop a picker of THIS card's SENT references — only chips toggled
// on (each shown with its Image index); choosing one inserts the citation the CARD'S OWN
// MODEL spells it with (`@Image1` for the 2.5 family, `Image 1` for 2.0) at
// the cursor — plain prompt text the video model reads, so a subject can be tied to a
// specific plate. A native <textarea> is used for precise caret control.
// `references` = [{ index, name, url }] in send order (only the ENABLED, sent refs).

const dark = {
  width: '100%', minHeight: '52vh', resize: 'vertical', boxSizing: 'border-box',
  fontSize: 13, lineHeight: 1.5, color: '#e5e6eb', background: '#0f1318',
  border: '1px solid #2a313a', borderRadius: 6, padding: 12, fontFamily: 'inherit', outline: 'none',
};

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Escape']);

const PromptEditorModal = ({ open, value, references = [], media = [], imageTag = (n) => `Image ${n}`, onChange, onClose }) => {
  const [text, setText] = useState(value || '');
  const [menu, setMenu] = useState(null); // { items: [{index,name,url}], hi } while an @-query is active
  const taRef = useRef(null);
  const reposRef = useRef(null); // caret offset to restore after a programmatic insert

  // Initialise from the card ONLY when the modal opens — NOT on every value change, or the
  // live patch-on-keystroke would re-fire this and close the @-picker mid-query.
  useEffect(() => { if (open) { setText(value || ''); setMenu(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the caret after we rewrite the value (token insertion).
  useEffect(() => {
    if (reposRef.current != null && taRef.current) {
      const p = reposRef.current; reposRef.current = null;
      taRef.current.focus();
      try { taRef.current.setSelectionRange(p, p); } catch { /* noop */ }
    }
  }, [text]);

  // Detect an active "@<query>" immediately before the caret (read the DOM so it's never
  // stale) → show the picker filtered by name/index; else hide it.
  const syncMenu = () => {
    const el = taRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/@(\w*)$/);
    if (!m || (!references.length && !media.length)) { setMenu(null); return; }
    const q = m[1].toLowerCase();
    const imgItems = references.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.index != null && `image${r.index}`.includes(q)));
    const mediaItems = media.filter((r) => !q || (r.name || '').toLowerCase().includes(q) || `${r.kind}${r.index}`.includes(q));
    const items = [...imgItems, ...mediaItems];
    setMenu(items.length ? { items, hi: 0 } : null);
  };

  const apply = (v) => { setText(v); onChange?.(v); };

  // Replace the active "@<query>" (from the @ up to the caret) with the ref's citation,
  // spelled the way this card's model spells it; "Audio N " / "Video N " for media.
  const insertRef = (r) => {
    const el = taRef.current;
    const caret = el ? el.selectionStart : text.length;
    const val = el ? el.value : text;
    const at = val.slice(0, caret).lastIndexOf('@');
    const start = at >= 0 ? at : caret;
    const token = r.kind === 'audio' ? `Audio ${r.index} ` : r.kind === 'video' ? `Video ${r.index} ` : `${imageTag(r.index)} `;
    apply(val.slice(0, start) + token + val.slice(caret));
    reposRef.current = start + token.length;
    setMenu(null);
  };

  const onKeyDown = (e) => {
    if (!menu) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMenu((mn) => mn && { ...mn, hi: (mn.hi + 1) % mn.items.length }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMenu((mn) => mn && { ...mn, hi: (mn.hi - 1 + mn.items.length) % mn.items.length }); }
    else if (e.key === 'Enter') { e.preventDefault(); insertRef(menu.items[menu.hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setMenu(null); }
  };

  return (
    <Modal
      title="Edit prompt"
      visible={open}
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>Done</Button>}
      style={{ width: 820, maxWidth: '94vw' }}
      maskClosable
      escToExit
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        Type <b>@</b> to reference an image, audio or video asset — it inserts the matching <b>{imageTag('N')}</b> / <b>Audio N</b> / <b>Video N</b> citation at the cursor.
      </Text>
      <div style={{ position: 'relative', marginTop: 8 }}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => apply(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => { if (!(menu && NAV_KEYS.has(e.key))) syncMenu(); }}
          onClick={syncMenu}
          placeholder="the shot's cinematic prompt — type @ to tie a subject to a reference image"
          style={dark}
        />
        {menu && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 5, minWidth: 280, maxHeight: 340, overflowY: 'auto', background: '#161b22', border: '1px solid #2a313a', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.5)', padding: 4 }}>
            {menu.items.map((r, i) => (
              <div
                key={`${r.kind || 'img'}-${r.index}`}
                onMouseDown={(e) => { e.preventDefault(); insertRef(r); }}
                onMouseEnter={() => setMenu((mn) => mn && { ...mn, hi: i })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: i === menu.hi ? '#2a313a' : 'transparent' }}
              >
                <b style={{ fontSize: 10, color: '#fff', background: r.kind === 'audio' ? 'rgba(120,22,255,0.7)' : r.kind === 'video' ? '#165dff' : 'rgba(0,0,0,0.5)', borderRadius: 7, padding: '0 5px' }}>
                  {r.kind === 'audio' ? `Audio${r.index}` : r.kind === 'video' ? `Video${r.index}` : `Image${r.index}`}
                </b>
                {r.url && !r.kind ? <img src={r.url} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} /> : null}
                <span style={{ fontSize: 12, color: '#e5e6eb' }}>{r.name}{r.role ? ` · ${r.role}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#86909c' }}>
        {references.length === 0
          ? <span>No references enabled on this card — toggle chips in the REFERENCES block first; only enabled refs are offered here.</span>
          : <span>Sent: {references.map((r) => `Image${r.index} = ${r.name}`).join('  ·  ')}</span>}
      </div>
    </Modal>
  );
};

export default PromptEditorModal;
