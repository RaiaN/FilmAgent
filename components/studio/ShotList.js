import { C, MONO, Tile, mediaOf } from './ui';
import { pad2 } from '../../utils/film/studio/model';
import { shotsOf } from '../../utils/film/core/shotList';

// THE SHOT LIST as a director reads it: every scene — where and when, how long — and its shots,
// one line each. `heroOf` puts the scene's picture beside it; `onScene` opens it.
export const ShotList = ({ list, heroOf, onScene }) => (
  <div style={{ display: 'grid', gap: 14 }}>
    {list.scenes.map((sc) => {
      const hero = heroOf ? heroOf(sc.n) : null;
      return (
        <div key={sc.n} role={onScene ? 'button' : undefined} className={onScene ? 'st-card' : undefined} onClick={onScene ? () => onScene(sc.n) : undefined} style={{ display: 'grid', gap: 12, padding: 16, borderRadius: 14, border: `1px solid ${C.line}`, background: C.raised, cursor: onScene ? 'pointer' : 'default' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {hero && (hero.kind === 'take' ? <Tile v={hero} w={116} /> : <img src={mediaOf(hero)} alt="" style={{ width: 116, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, display: 'block', flex: '0 0 auto' }} />)}
            <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, fontSize: 20 }}>{pad2(sc.n)}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.ink, flex: 1, minWidth: 0, letterSpacing: -0.2 }}>{sc.place}{sc.time ? <span style={{ color: C.muted, fontWeight: 400 }}> · {sc.time}</span> : null}</span>
            {sc.sheet?.seconds ? <span style={{ fontFamily: MONO, fontSize: 14, color: C.muted }}>{sc.sheet.seconds}s</span> : null}
          </div>
          {sc.error && <div style={{ fontSize: 14, color: C.warn }}>{sc.error}</div>}
          {shotsOf(sc.sheet).map((sh, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 6, fontSize: 15, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.muted, paddingTop: 2 }}>{i + 1}</span>
              <span title={onScene ? sh.action : undefined} style={{ color: C.text, ...(onScene ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>{sh.action}</span>
            </div>
          ))}
        </div>
      );
    })}
  </div>
);
