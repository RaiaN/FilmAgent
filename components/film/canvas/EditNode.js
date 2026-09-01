import { memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Button, Tag, Message } from '@arco-design/web-react';
import { IconLoading, IconExpand, IconSync, IconVideoCamera } from '@arco-design/web-react/icon';
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

const promptArea = {
  width: '100%', background: '#0f1318', color: '#e5e6eb',
  border: '1px solid #2a313a', borderRadius: 4, fontSize: 11, lineHeight: 1.45, padding: 8,
};

const EditNodeInner = ({ id, data, selected }) => {
  const { onPatchCut, bibleEntries, onShootCut, onComposeCut, onOpenTakes, onPickMaster, onDetachRef, onOpenRefDrawer } = useContext(CutContext);
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
  const status = data.status === 'running' ? { label: 'shooting…', color: '#f7ba1e' }
    : data.status === 'failed' ? { label: 'failed', color: '#f53f3f' }
      : data.shotUrl ? { label: 'take landed', color: '#00b42a' } : null;

  return (
    <div style={{ width: 780, background: '#101418', borderRadius: 10, border: `2px solid ${selected ? '#1D9E75' : '#28313c'}`, boxShadow: selected ? '0 0 0 3px rgba(29,158,117,0.16)' : '0 1px 4px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
      <Handle type="target" position={Position.Left} title="continuity in" style={{ width: 9, height: 9, background: '#1D9E75', border: '2px solid #101418' }} />
      <Handle type="source" position={Position.Right} title="chain: this card's take becomes the next edit's master" style={{ width: 9, height: 9, background: '#1D9E75', border: '2px solid #101418' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'repeating-linear-gradient(135deg, #16241f 0 12px, #1D9E75 12px 24px)' }}>
        <Tag size="small" style={{ background: '#101418', color: '#5DCAA5', border: 'none', fontWeight: 700 }}>EDIT</Tag>
        <EditableLabel value={data.beat || 'Edit'} onCommit={(v) => patch({ beat: v })} style={{ color: '#e5e6eb', fontSize: 12, fontWeight: 600 }} />
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
        <Button
          className="nodrag" size="mini" type="primary" icon={<IconVideoCamera />}
          disabled={!onShootCut || !master || tooShort || busy || data.status === 'running'}
          onClick={() => onShootCut && onShootCut(id)}
          style={{ background: '#1D9E75', borderColor: '#1D9E75', height: 20 }}
          title={master ? 'Shoot the edit — the master rides as the sole editing reference' : 'Pick a master first'}
        >🎬</Button>
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
