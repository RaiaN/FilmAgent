import { memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Button, Tag, Message } from '@arco-design/web-react';
import { IconLoading, IconExpand, IconSync, IconVideoCamera, IconEye } from '@arco-design/web-react/icon';
import { RES_BY_MODEL, resDefault, videoModelKeyOf, videoTraits, imageTagOf } from '../../../utils/film/suiteConfig';
import { shotReferences } from '../../../utils/film/recipes';
import { CutContext } from './CutNode';
import { SeedanceParams, BLOCK_LABEL, DraftText, ReferencesRow } from './cardBlocks';
import EditableLabel from './EditableLabel';
import PromptEditorModal from './PromptEditorModal';

const { Text } = Typography;

// THE EDIT CARD. A SHOT card generates; this one EDITS — one existing video is the sole
// master, and the take that comes back inherits its scene, camera, trajectories and
// event order. That inheritance is why ratio and duration are facts here rather than
// choices: the endpoint locks both to the master and rejects a request that sends them.
//
// Its own node type on purpose. Sharing `cut` and switching on data would leave every
// `type === 'cut'` site silently treating an edit as a generation — sending ratio,
// offering keyframes, composing the wrong template. A distinct type makes each of those
// sites fail loudly until someone decides, which is the failure mode we want.
export const MIN_MASTER_SECONDS = 4; // Ark: editing tasks need a 4–30s source

// How an edit instruction opens. Naming the source video is what routes the request as
// an EDIT rather than a new generation, so a card starts with this and an insert into an
// empty field restores it — a bare noun would read as a description of a shot to make.
export const EDIT_OPENER = 'Edit @Video1';

const promptArea = {
  width: '100%', background: '#0f1318', color: '#e5e6eb',
  border: '1px solid #2a313a', borderRadius: 4, fontSize: 11, lineHeight: 1.45, padding: 8,
};

const EditNodeInner = ({ id, data, selected }) => {
  const { onPatchCut, bibleEntries, onShootCut, onComposeCut, onAnalyzeCut, onOpenTakes, onPickMaster, onDetachRef, onOpenRefDrawer } = useContext(CutContext);
  const [editorOpen, setEditorOpen] = useState(false);
  const patch = (p) => onPatchCut && onPatchCut(id, p);

  const videoModel = videoModelKeyOf(data.videoModel);
  const resOptions = RES_BY_MODEL[videoModel] || RES_BY_MODEL.seedance;
  const resolution = resOptions.includes(data.resolution) ? data.resolution : resDefault(videoModel);

  const master = data.master || null;
  const masterSec = Number(master?.duration) || 0;
  // A source under the floor cannot be edited at all — say so on the card, before spend.
  const tooShort = !!master && masterSec > 0 && masterSec < MIN_MASTER_SECONDS;
  // TARGET MATERIAL: the images an edit replaces INTO. Same chips as a SHOT card's
  // references, different job — the spec calls them the target material.
  const targets = shotReferences(data, bibleEntries);
  const busy = !!(data.developing || data.composePending);
  // An analysis describes ONE master. Picking a different master leaves it on the card but
  // marks it stale, and Compose stops using it until the new master is analyzed.
  const analysis = String(data.analysis || '').trim();
  const analysisStale = !!analysis && !!master && data.analyzedMasterUrl !== master.url;
  const subjects = Array.isArray(data.analysisSubjects) ? data.analysisSubjects.filter((x) => x && x.name) : [];
  // Clicking a subject types its name into THE EDIT, built on the card's LATEST text: the
  // click blurs THE EDIT first, and that commit must survive the insert.
  const insertSubject = (name) => patch((d) => {
    const cur = String(d.promptOverride || '').trim() ? String(d.promptOverride) : EDIT_OPENER;
    return { promptOverride: `${cur}${/\s$/.test(cur) ? '' : ' '}${name}` };
  });
  // Only IN PROGRESS earns a chip. A landed take is already announced by the take
  // count; a failure speaks in the body, where its reason fits.
  const status = data.status === 'running' ? { label: 'shooting…', color: '#f7ba1e' } : null;

  return (
    <div style={{ width: 780, background: '#101418', borderRadius: 10, border: `2px solid ${selected ? '#1D9E75' : '#28313c'}`, boxShadow: selected ? '0 0 0 3px rgba(29,158,117,0.16)' : '0 1px 4px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
      <Handle type="target" position={Position.Left} title="continuity in" style={{ width: 9, height: 9, background: '#1D9E75', border: '2px solid #101418' }} />
      <Handle type="source" position={Position.Right} title="chain: this card's take becomes the next edit's master" style={{ width: 9, height: 9, background: '#1D9E75', border: '2px solid #101418' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'repeating-linear-gradient(135deg, #16241f 0 12px, #1D9E75 12px 24px)' }}>
        <Tag size="small" style={{ background: '#101418', color: '#5DCAA5', border: 'none', fontWeight: 700 }}>EDIT</Tag>
        {Number(data.takeCount) > 0 && (
          <Tag
            size="small" className="nodrag"
            title="Open this card's renders in the Take Library"
            onClick={(e) => { e.stopPropagation(); onOpenTakes && onOpenTakes(id); }}
            style={{ background: '#101418', color: '#9fb4d0', border: 'none', fontWeight: 700, cursor: 'pointer' }}
          >🎞 View takes ({data.takeCount})</Tag>
        )}
        {status && <Tag size="small" style={{ background: '#101418', color: status.color, border: 'none', fontWeight: 700 }}>{status.label}</Tag>}
        <span style={{ flex: 1 }} />
        {/* Only the endpoint's real preconditions gate 🎬: a master, and one long enough
            to edit. NOT busy-state — a SHOT card fires as many parallel takes as you
            like, and gating on `running` bricks a card whose status got stuck. */}
        <Button
          className="nodrag" size="mini" type="primary" icon={<IconVideoCamera />}
          disabled={!onShootCut || !master || tooShort}
          onClick={() => onShootCut && onShootCut(id)}
          style={{ background: '#1D9E75', borderColor: '#1D9E75', height: 20 }}
          title={master ? 'Shoot the edit — the master rides as the sole editing reference' : 'Pick a master first'}
        >🎬</Button>
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EditableLabel
          value={data.beat}
          onCommit={(v) => patch({ beat: v })}
          placeholder="Edit"
          maxLength={60}
          title="Double-click to rename this edit"
          pencilColor="#5a6472"
          containerStyle={{ width: '100%' }}
          textStyle={{ color: '#5DCAA5', fontSize: 12, fontWeight: 700 }}
          inputStyle={{ fontSize: 12, fontWeight: 700, color: '#5DCAA5', background: '#161b22', borderColor: '#2a313a' }}
        />
        {data.status === 'failed' && String(data.error || '').trim() && (
          <div style={{ padding: '6px 8px', background: '#2a1215', border: '1px solid #a8071a', borderRadius: 4 }}>
            <Text style={{ fontSize: 10, color: '#f7a4a4' }}>Shot failed — {data.error}</Text>
          </div>
        )}
        {/* THE MASTER — one video, exclusive. Everything the take does not change is
            inherited from it, so it is the card's first and most consequential field. */}
        <div>
          <Text style={{ ...BLOCK_LABEL, display: 'block', marginBottom: 3 }}>MASTER · the video being edited</Text>
          {master ? (
            <div
              className="nodrag"
              onClick={() => onPickMaster && onPickMaster(id)}
              title="Click to pick a different master"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: '#0f1318', border: `1px solid ${tooShort ? '#a8071a' : '#2a313a'}`, borderRadius: 4, cursor: 'pointer' }}
            >
              <div style={{ width: 84, height: 48, borderRadius: 3, background: '#16241f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {master.posterUrl
                  ? <img src={master.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <IconVideoCamera style={{ fontSize: 18, color: '#5DCAA5' }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#e5e6eb', display: 'block' }} ellipsis>{master.label || 'master'}</Text>
                <Text style={{ fontSize: 10, color: '#6e7b8b' }}>
                  {masterSec ? `${masterSec.toFixed(1)}s` : 'duration unread'}{master.ratio ? ` · ${master.ratio}` : ''}
                </Text>
                {tooShort && (
                  <Text style={{ fontSize: 10, color: '#f53f3f', display: 'block' }}>
                    under {MIN_MASTER_SECONDS}s — an editing task needs a {MIN_MASTER_SECONDS}–30s source
                  </Text>
                )}
              </div>
            </div>
          ) : (
            <Button
              className="nodrag" size="small" long
              onClick={() => (onPickMaster ? onPickMaster(id) : Message.warning('No picker wired.'))}
              style={{ borderStyle: 'dashed', color: '#9fb4d0' }}
            >＋ Pick a master — any take, or a video on the board</Button>
          )}
        </div>

        {/* SHOT ANALYSIS — what is actually in the master, described by a model watching it.
            Read it before Compose: Compose grounds the edit in this text, so a wrong subject
            or side corrected here is corrected in the prompt too. */}
        {master && (
          <div>
            <div style={{ marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={BLOCK_LABEL}>SHOT ANALYSIS</Text>
              <Button
                className="nodrag" size="mini" type="text"
                icon={data.analyzing ? <IconLoading /> : <IconEye />}
                disabled={!onAnalyzeCut || !!data.analyzing}
                onClick={() => onAnalyzeCut && onAnalyzeCut(id)}
                style={{ color: '#9fb4d0' }}
                title="Analyze — the reasoner watches the master and describes the shot: setting and light, every subject and when it is visible, the action and the camera. It describes the footage only. You can edit the result."
              >{analysis ? 'Re-analyze' : 'Analyze'}</Button>
            </div>
            {data.analyzing ? (
              <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 10px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, minHeight: 62 }}>
                <IconLoading style={{ fontSize: 16, color: '#5DCAA5' }} />
                <Text style={{ color: '#5DCAA5', fontSize: 11, fontWeight: 700 }}>Watching the master…</Text>
              </div>
            ) : analysis ? (
              <>
                {analysisStale && (
                  <Text style={{ fontSize: 10, color: '#f7ba1e', display: 'block', marginBottom: 3 }}>
                    This describes a different master — Compose ignores it until you Re-analyze.
                  </Text>
                )}
                <DraftText
                  textarea className="nodrag nowheel" value={data.analysis}
                  onCommit={(v) => patch({ analysis: v })}
                  autoSize={{ minRows: 3, maxRows: 14 }}
                  style={{ ...promptArea, color: '#c9d1d9', opacity: analysisStale ? 0.55 : 1 }}
                />
                {!analysisStale && subjects.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                    {subjects.map((sub) => (
                      <Tag
                        key={sub.name} size="small" className="nodrag"
                        onClick={(e) => { e.stopPropagation(); if (!busy) insertSubject(sub.name); }}
                        title={`Insert "${sub.name}" into THE EDIT`}
                        style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, background: '#16241f', color: '#5DCAA5', border: '1px solid #24473b' }}
                      >
                        ＋ {sub.name}{sub.visible ? <span style={{ color: '#6e7b8b' }}> · {sub.visible}</span> : null}
                      </Tag>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Text style={{ fontSize: 10, color: '#6e7b8b', display: 'block' }}>
                Not analyzed yet. Analyze watches the master and describes the shot.
              </Text>
            )}
          </div>
        )}

        <div>
          <div style={{ marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={BLOCK_LABEL}>THE EDIT</Text>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <Button className="nodrag" size="mini" type="text" icon={busy ? <IconLoading /> : <IconSync />} disabled={!onComposeCut || busy || !master} onClick={() => onComposeCut && onComposeCut(id)} style={{ color: '#9fb4d0' }} title="Compose — writes the FINAL editing prompt under this model's skill: what changes, what is preserved, and the scope closure">Compose</Button>
              <Button className="nodrag" size="mini" type="text" icon={<IconExpand />} onClick={() => setEditorOpen(true)} style={{ color: '#9fb4d0' }} title="Expand — full-size editor with @-mention">Expand</Button>
            </span>
          </div>
          {busy ? (
            <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 10px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, minHeight: 62 }}>
              <IconLoading style={{ fontSize: 16, color: '#5DCAA5' }} />
              <Text style={{ color: '#5DCAA5', fontSize: 11, fontWeight: 700 }}>Writing the edit…</Text>
            </div>
          ) : (
            <DraftText
              textarea className="nodrag nowheel" value={data.promptOverride}
              onCommit={(v) => patch({ promptOverride: v })}
              placeholder="what changes — and what must stay. e.g. replace the wet alley with a rain-lit canal street from Image 1; everything else unchanged"
              autoSize={{ minRows: 3, maxRows: 12 }} style={promptArea}
            />
          )}
        </div>

        <ReferencesRow
          id={id} data={data} patch={patch} bibleEntries={bibleEntries} onOpenRefDrawer={onOpenRefDrawer}
          label={`TARGET MATERIAL → ${imageTagOf(videoModel, '1')}…N · what the edit replaces INTO`}
        />

        <SeedanceParams
          data={data} patch={patch} videoModel={videoModel} resolution={resolution} resOptions={resOptions}
          lockFrame
          lockNote={`An editing task inherits both from the master${masterSec ? ` (${masterSec.toFixed(1)}s${master?.ratio ? `, ${master.ratio}` : ''})` : ''}. Sending either is rejected by the endpoint.`}
        />

        {!videoTraits(videoModel).keyframes && master && (
          <Text style={{ fontSize: 10, color: '#6e7b8b' }}>
            This model has no keyframe control — the master governs camera and timing either way.
          </Text>
        )}
      </div>

      {editorOpen && (
        <PromptEditorModal
          open value={data.promptOverride || ''}
          references={targets.map((r, i) => ({ index: i + 1, name: r.name || 'ref', url: r.url }))}
          imageTag={(n) => imageTagOf(videoModel, n)}
          media={[]}
          onChange={(v) => patch({ promptOverride: v })}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
};

export default memo(EditNodeInner);
