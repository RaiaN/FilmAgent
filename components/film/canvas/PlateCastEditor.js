import { memo, useState } from 'react';
import { Button, Select, Typography } from '@arco-design/web-react';
import { IconClose, IconCheck } from '@arco-design/web-react/icon';


const { Text } = Typography;

// The five silhouette colors, in the mask template's left→right order (WHITE is the
// camera, never a character).
// The mask palette (blue→purple, left-to-right silhouette order) — was shared with the
// purged Arrows editor; lives here now.
const CAST_COLORS = [
  { hex: '#165dff', name: 'BLUE' },
  { hex: '#00b42a', name: 'GREEN' },
  { hex: '#fadc19', name: 'YELLOW' },
  { hex: '#f53f3f', name: 'RED' },
  { hex: '#722ed1', name: 'PURPLE' },
];

// Cast the colors: bind each silhouette color on a blocking plate to a bible character.
// Purely manual — the user looks at the plate and picks; the assignment lives on the
// plate (data.colorCast) and is reused by EVERY card the plate attaches to: the attach
// auto-adds the assigned characters as refs and writes the named, correctly numbered
// FIRST FRAME lock. Unassigned colors = background figures (no identity lock).
const PlateCastEditor = ({ src, colorCast = {}, characters = [], onSave, onClose }) => {
  const [map, setMap] = useState(colorCast || {});
  const pick = (colorName, entryId) => setMap((m) => {
    if (!entryId) { const n = { ...m }; delete n[colorName]; return n; }
    const ch = characters.find((x) => x.id === entryId);
    if (!ch) return m;
    return { ...m, [colorName]: { entryId: ch.id, nodeId: ch.nodeId || null, name: ch.name || 'character' } };
  });
  const assigned = Object.keys(map).length;

  return (
    <div className="nodrag nowheel" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="plate-cast-panel" style={{ position: 'relative', background: '#161b22', border: '1px solid #2a313a', borderRadius: 12, padding: 14, maxWidth: '92vw', maxHeight: '92vh', display: 'flex', gap: 14, color: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="blocking plate" style={{ display: 'block', maxWidth: '44vw', maxHeight: '70vh', borderRadius: 8, alignSelf: 'center' }} draggable={false} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#f7ba1e', fontSize: 13, fontWeight: 700, flex: 1 }}>Cast the colors</Text>
            <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} style={{ color: '#86909c' }} />
          </div>
          <Text style={{ color: '#86909c', fontSize: 12 }}>Colors read left → right on the plate. Bind each silhouette to its character — attaching then auto-adds those refs and writes the named lock. Leave background figures unassigned.</Text>
          {characters.length === 0 ? (
            <Text style={{ color: '#86909c', fontSize: 12 }}>No cast in the bible yet — run Cast &amp; World (or tag character plates) first.</Text>
          ) : CAST_COLORS.map((c) => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: c.hex, flexShrink: 0, border: '1px solid rgba(255,255,255,0.25)' }} />
              <Text style={{ color: '#9fb4d0', fontSize: 11, width: 56, flexShrink: 0 }}>{c.name}</Text>
              <Select
                className="nodrag"
                size="small"
                allowClear
                placeholder="background figure"
                style={{ flex: 1 }}
                value={map[c.name]?.entryId}
                onChange={(v) => pick(c.name, v)}
                // Render the options popup INSIDE the modal panel — the default
                // document.body portal stacks BELOW this overlay (zIndex 1200), which
                // made the open dropdown invisible ("the feature doesn't work").
                triggerProps={{ autoAlignPopupWidth: false, getPopupContainer: (node) => node.closest('.plate-cast-panel') || document.body }}
              >
                {characters.map((ch) => (
                  <Select.Option key={ch.id} value={ch.id}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {ch.url ? <img src={ch.url} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} /> : null}
                      {ch.name}
                    </span>
                  </Select.Option>
                ))}
              </Select>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <span style={{ flex: 1 }} />
            <Button size="mini" onClick={onClose}>Cancel</Button>
            <Button size="mini" type="primary" icon={<IconCheck />} onClick={() => onSave && onSave(map)} style={{ background: '#b06f10', borderColor: '#b06f10' }}>
              Save{assigned ? ` (${assigned})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(PlateCastEditor);
