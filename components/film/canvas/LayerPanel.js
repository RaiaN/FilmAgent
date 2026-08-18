import { Button, Checkbox, Input, InputNumber, Select, Typography } from '@arco-design/web-react';
import { IconPlayArrow, IconPlus, IconClose } from '@arco-design/web-react/icon';
import { AGENT_MAP, IMAGE_RESOLUTIONS } from '../../../utils/film/agents';
import { IMAGE_MODEL_OPTIONS, imageModelKeyOf, imageTraits, maxShotSeconds, defaultVideoModelKey } from '../../../utils/film/suiteConfig';
import { SHOT_TEMPLATES_BY_CATEGORY } from '../../../utils/film/recipes';
import { agentIcon } from './agentIcons';

const { Text, Title, Paragraph } = Typography;

// The agent CONFIGURATION surface — nothing lands on the board from a rail click.
// Two modes, one form:
//  · DRAFT (rail/context-menu tap): edit the agent's draft settings (persisted in
//    layerSettings), then the primary button ADDS the configured element — an agent
//    card (inert), a Brief/SHOT card, or the storyboard element.
//  · BOUND (an agent card is selected): the same fields read/patch that card's
//    node.data.settings directly — a VIEW onto the node, never a copy — and the
//    primary button Runs THAT card.

const SIZE_OPTIONS = IMAGE_RESOLUTIONS; // API-accepted tiers (2K/3K/4K) — never a bare '1K'

const FIELD_LABEL = { fontSize: 12, color: '#86909c', display: 'block', marginBottom: 4 };

// ENABLED-ONLY inline display over the board's images (single or multi) — shows just
// the picked thumbs (click removes); browsing/adding lives in the shared reference
// drawer behind the Browse button (search + role tabs + big tiles).
const BoardImagePicker = ({ imageAssets, value, onPick, multi = false, emptyHint, onBrowse }) => {
  const picked = multi ? (value || []) : (value ? [value] : []);
  const shown = picked.map((rid) => imageAssets.find((a) => a.id === rid)).filter(Boolean);
  return (
    <div>
      {shown.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {shown.map((a) => (
            <div
              key={a.id}
              onClick={() => (multi ? onPick(picked.filter((x) => x !== a.id)) : onPick(''))}
              title={`${a.label} — click to remove`}
              style={{ position: 'relative', width: 54, height: 54, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '2px solid #165dff' }}
            >
              <img src={a.url} alt={a.label} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, opacity: 0.8, display: 'block' }}>{emptyHint || 'None picked yet.'}</Text>
      )}
      {onBrowse && (
        <Button size="mini" style={{ marginTop: 6 }} onClick={onBrowse}>{multi ? 'Browse references…' : (shown.length ? 'Swap…' : 'Pick from the board…')}</Button>
      )}
    </div>
  );
};

// ENABLED-ONLY inline display over the board's audio clips — the picked rows wear
// their @Audio1..N numbers (pick order = number); click removes; adding lives in
// the shared reference drawer.
const BoardAudioPicker = ({ audioAssets, value, onPick, onBrowse }) => {
  const picked = value || [];
  const shown = picked.map((rid) => audioAssets.find((a) => a.id === rid)).filter(Boolean);
  return (
    <div>
      {shown.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shown.map((a) => {
            const at = picked.indexOf(a.id);
            return (
              <div
                key={a.id}
                onClick={() => onPick(picked.filter((x) => x !== a.id))}
                title={`${a.label} — click to remove`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, border: '1px solid #7816ff', background: '#f5f0ff' }}
              >
                <span style={{ fontWeight: 600, color: '#7816ff', minWidth: 54, flexShrink: 0 }}>@Audio{at + 1}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                {a.duration ? <span style={{ color: '#86909c', flexShrink: 0 }}>{Math.round(a.duration)}s</span> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, opacity: 0.8, display: 'block' }}>No reference clips picked.</Text>
      )}
      {onBrowse && <Button size="mini" style={{ marginTop: 6 }} onClick={onBrowse}>Browse clips…</Button>}
    </div>
  );
};

const ShotTemplateSelect = ({ value, onChange, placeholder = 'let the model choose' }) => (
  <Select
    size="small" style={{ width: '100%' }} placeholder={placeholder} allowClear showSearch
    value={value || undefined} onChange={(v) => onChange(v || '')}
    filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.toLowerCase())}
  >
    {SHOT_TEMPLATES_BY_CATEGORY.map(({ category, templates }) => (
      <Select.OptGroup key={category} label={category}>
        {templates.map((t) => <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>)}
      </Select.OptGroup>
    ))}
  </Select>
);

const ModelSelect = ({ value, onChange }) => (
  <Select size="small" style={{ width: '100%' }} value={imageModelKeyOf(value)} onChange={onChange}
    options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))} />
);

// Storyboard consistency lever — the customer's race-drift fix. Free-typeable (allowCreate).
const ETHNICITY_OPTIONS = ['Unspecified', 'South Asian', 'East Asian', 'Southeast Asian', 'Black / African', 'White / Caucasian', 'Hispanic / Latino', 'Middle Eastern', 'Indigenous', 'Mixed'];
// Storyboard look — feeds keyframe line 1. Auto = the shot division picks a fitting aesthetic.
const STYLE_OPTIONS = ['Auto', 'photo-real', 'cinematic', 'retro', 'noir', 'anime', 'comic / graphic novel', 'watercolor', 'documentary'];

// ---- per-agent field bodies --------------------------------------------------------

const StoryFields = ({ s, up }) => (
  <div>
    <Text style={FIELD_LABEL}>Your brief</Text>
    <Input.TextArea
      value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
      placeholder="an idea, a description or a full script — lands on the board VERBATIM as a Brief card (leave blank for an empty card to type into)"
      autoSize={{ minRows: 3, maxRows: 8 }}
    />
  </div>
);

const ShotFields = ({ s, up }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Shot description (optional)</Text>
      <Input.TextArea
        value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
        placeholder="what happens in the shot… or leave blank and write it on the card"
        autoSize={{ minRows: 3, maxRows: 6 }}
      />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Camera preset</Text>
      <ShotTemplateSelect value={s.shotTemplate} onChange={(v) => up({ shotTemplate: v })} placeholder="cinematography…" />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Duration</Text>
      <InputNumber size="small" min={5} max={maxShotSeconds(defaultVideoModelKey())} value={s.durationSec} onChange={(v) => up({ durationSec: v })} style={{ width: 90 }} suffix="s" />
    </div>
  </>
);

const StoryboardFields = ({ s, up, imageAssets, onOpenRefDrawer }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Scene to board (optional) — type or edit it on the card too</Text>
      <Input.TextArea
        value={s.script || ''} onChange={(v) => up({ script: v })}
        placeholder="paste the scene or script — rides onto the storyboard card, verbatim"
        autoSize={{ minRows: 3, maxRows: 8 }}
      />
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <Text style={FIELD_LABEL}>Style</Text>
        <Select allowCreate size="small" style={{ width: '100%' }} placeholder="Auto"
          value={s.style || undefined} onChange={(v) => up({ style: v })}
          options={STYLE_OPTIONS.map((x) => ({ label: x, value: x }))} />
      </div>
    </div>
    <div>
      <Text style={FIELD_LABEL}>Image model</Text>
      <ModelSelect value={s.imageModel} onChange={(v) => up({ imageModel: v })} />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Ethnicity (optional) — keeps characters from drifting</Text>
      <Select allowCreate allowClear size="small" style={{ width: '100%' }} placeholder="Unspecified"
        value={s.ethnicity || undefined} onChange={(v) => up({ ethnicity: v })}
        options={ETHNICITY_OPTIONS.map((x) => ({ label: x, value: x }))} />
    </div>
    <div>
      <Text style={FIELD_LABEL}>References (optional) — board images that anchor characters &amp; props</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.refs || []} onPick={(refs) => up({ refs })} multi
        onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('refs') : undefined}
        emptyHint="None picked — browse the library below, or drop images on the board first." />
    </div>
  </>
);

const PrevizFields = ({ s, up }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Scene brief — empty = the selected Brief card</Text>
      <Input.TextArea
        value={s.brief || ''} onChange={(v) => up({ brief: v })}
        placeholder="the scene to block — who is where, what stands between them; leave empty to read the selected Brief verbatim"
        autoSize={{ minRows: 4, maxRows: 10 }}
      />
    </div>
    <Text type="secondary" style={{ fontSize: 12 }}>
      Run renders the scene&rsquo;s SCHEMATIC — an overhead blocking map (parties, moves, the AXIS). Edit it like any image; attach it to a SHOT card to project blocking into the prompt.
    </Text>
  </>
);

const CastFields = ({ s, up, imageAssets, onOpenRefDrawer }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Film idea — empty = the selected Brief, or references alone</Text>
      <Input.TextArea
        value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
        placeholder="one sentence: what is this film about… e.g. 'a lighthouse keeper befriends the sea monster wrecking the ships'"
        autoSize={{ minRows: 3, maxRows: 6 }}
      />
    </div>
    <div>
      <Text style={FIELD_LABEL}>References (optional) — storyboards, sketches or photos the cast derives from</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.refs || []} onPick={(refs) => up({ refs })} multi
        onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('refs') : undefined}
        emptyHint="None picked — the cast comes from the idea text alone." />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Ethnicity (optional) — every human character, unless the idea says otherwise</Text>
      <Select allowCreate allowClear size="small" style={{ width: '100%' }} placeholder="Unspecified"
        value={s.ethnicity || undefined} onChange={(v) => up({ ethnicity: v })}
        options={ETHNICITY_OPTIONS.map((x) => ({ label: x, value: x }))} />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Image model</Text>
      <ModelSelect value={s.imageModel} onChange={(v) => up({ imageModel: v })} />
      {imageTraits(s.imageModel).thinkingToggle && (
        <Checkbox style={{ marginTop: 6 }} checked={!!s.imageThinking} onChange={(c) => up({ imageThinking: c })}>
          <Text type="secondary" style={{ fontSize: 12 }}>Prompt thinking — Pro reasons about each plate first (slower; text-to-image plates only)</Text>
        </Checkbox>
      )}
    </div>
  </>
);

const InspirationFields = ({ s, up, imageAssets, onOpenRefDrawer }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Prompt</Text>
      <Input.TextArea
        value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
        placeholder="mood, era, palette, references… e.g. 'cold war Arctic outpost, 16mm, desaturated teal'"
        autoSize={{ minRows: 3, maxRows: 6 }}
      />
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <div>
        <Text style={FIELD_LABEL}>Count</Text>
        <InputNumber size="small" min={1} max={12} value={s.count} onChange={(v) => up({ count: v })} style={{ width: 80 }} />
      </div>
      <div>
        <Text style={FIELD_LABEL}>Size</Text>
        <Select size="small" value={s.size} onChange={(v) => up({ size: v })} style={{ width: 90 }} options={SIZE_OPTIONS.map((x) => ({ label: x, value: x }))} />
      </div>
    </div>
    <div>
      <Text style={FIELD_LABEL}>Style references (optional) — pick board images to seed the moods</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.refs || []} onPick={(refs) => up({ refs })} multi
        onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('refs') : undefined}
        emptyHint="None picked — the moods come from the prompt alone." />
      {(s.refs || []).length > 0 && (
        <Checkbox style={{ marginTop: 6 }} checked={!!s.useSelectionAsRefs} onChange={(c) => up({ useSelectionAsRefs: c })}>
          <Text type="secondary" style={{ fontSize: 12 }}>Also feed them to the image model as visual refs (not just the planner)</Text>
        </Checkbox>
      )}
    </div>
  </>
);

const VariationsFields = ({ agentId, s, up, imageAssets, onOpenRefDrawer }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Source image — the {agentId === 'locationVariations' ? 'location' : 'character'} to vary</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.anchorId || ''} onPick={(anchorId) => up({ anchorId })}
        onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('anchorId') : undefined}
        emptyHint="No source picked yet." />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Direction (optional)</Text>
      <Input.TextArea
        value={s.direction || ''} onChange={(v) => up({ direction: v })}
        placeholder={agentId === 'locationVariations'
          ? "what to explore… e.g. 'different times of day', 'tighter angles', 'in winter' — or leave blank and the agent decides"
          : "what to explore… e.g. 'different wardrobes', 'across ages', 'range of expressions' — or leave blank and the agent decides"}
        autoSize={{ minRows: 2, maxRows: 4 }}
      />
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <div>
        <Text style={FIELD_LABEL}>Count</Text>
        <InputNumber size="small" min={1} max={8} value={s.count} onChange={(v) => up({ count: v })} style={{ width: 80 }} />
      </div>
      <div>
        <Text style={FIELD_LABEL}>Size</Text>
        <Select size="small" value={s.size} onChange={(v) => up({ size: v })} style={{ width: 90 }} options={SIZE_OPTIONS.map((x) => ({ label: x, value: x }))} />
      </div>
    </div>
    <div>
      <Text style={FIELD_LABEL}>Image model</Text>
      <ModelSelect value={s.imageModel} onChange={(v) => up({ imageModel: v })} />
    </div>
  </>
);


const AudioFields = ({ s, up, imageAssets, audioAssets, onOpenRefDrawer }) => {
  const nRefs = (s.audioRefs || []).length;
  return (
    <>
      <div>
        <Text style={FIELD_LABEL}>Audio prompt — sent word for word; describe the voices, delivery and sounds you want (≤2048 chars, ≤120s of audio)</Text>
        <Input.TextArea
          value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
          placeholder="a line to speak, an ambience, a sound effect, a whole radio scene…"
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      </div>
      <div>
        <Text style={FIELD_LABEL}>Voice / sound references (optional, up to 3) — pick board clips, then call them @Audio1{nRefs > 1 ? `…@Audio${nRefs}` : ''} in the prompt (pick order = number)</Text>
        <BoardAudioPicker audioAssets={audioAssets} value={s.audioRefs || []} onPick={(audioRefs) => up({ audioRefs, ...(audioRefs.length ? { imageRef: '' } : {}) })} onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('audioRefs') : undefined} />
      </div>
      <div>
        <Text style={FIELD_LABEL}>Mood reference (optional) — one board image sets the scene; cannot mix with audio references</Text>
        <BoardImagePicker imageAssets={imageAssets} value={s.imageRef || ''} onPick={(imageRef) => up({ imageRef, ...(imageRef ? { audioRefs: [] } : {}) })} onBrowse={onOpenRefDrawer ? () => onOpenRefDrawer('imageRef') : undefined} />
      </div>
    </>
  );
};

export const AGENT_FIELDS = {
  story: StoryFields,
  shot: ShotFields,
  storyboard: StoryboardFields,
  cast: CastFields,
  previz: PrevizFields,
  inspiration: InspirationFields,
  characterVariations: VariationsFields,
  locationVariations: VariationsFields,
  audio: AudioFields,
};

// The draft-mode primary per agent: EVERY primary is add-type — it places a
// configured, INERT element; generation is always a tap on the element itself
// (the storyboard's division runs from its node's Divide button / first message).
const DRAFT_PRIMARY = {
  story: { label: 'Add Brief card', needsKey: false },
  shot: { label: 'Add SHOT card', needsKey: false },
  storyboard: { label: 'Add storyboard', needsKey: false },
};

const LayerPanel = ({ agentId, values, onChange, imageAssets = [], audioAssets = [], onOpenRefDrawer, running, draft, onPrimary, onClose, apiKeyPresent }) => {
  const agent = AGENT_MAP[agentId];
  if (!agent) return null;
  const s = values || {};
  const Body = AGENT_FIELDS[agentId];
  const Icon = agentIcon(agent.icon);


  const primary = draft ? (DRAFT_PRIMARY[agentId] || { label: 'Add to board', needsKey: false }) : { label: `Run ${agent.label}`, needsKey: true };
  const canPrimary = !running && (!primary.needsKey || apiKeyPresent);
  const addType = draft && !primary.needsKey;

  return (
    <div style={{ width: 300, borderLeft: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4, background: agent.color }} />
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <Icon style={{ color: agent.color, fontSize: 18, flexShrink: 0 }} />
          <Title heading={6} style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.label}</Title>
        </span>
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>
      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>{agent.describe}</Paragraph>
        {Body ? <Body agentId={agentId} s={s} up={onChange} imageAssets={imageAssets} audioAssets={audioAssets} onOpenRefDrawer={onOpenRefDrawer} /> : null}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid #f2f3f5' }}>
        {primary.needsKey && !apiKeyPresent && (
          <Text type="error" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>Add your API key first — Project (header) → API key.</Text>
        )}
        <Button
          type="primary"
          long
          icon={addType ? <IconPlus /> : <IconPlayArrow />}
          loading={running}
          disabled={!canPrimary}
          onClick={onPrimary}
          style={{ background: canPrimary ? agent.color : undefined, borderColor: canPrimary ? agent.color : undefined }}
        >
          {running ? 'Generating…' : primary.label}
        </Button>
      </div>
    </div>
  );
};

export default LayerPanel;
