import { Button, Checkbox, Input, InputNumber, Select, Typography } from '@arco-design/web-react';
import { IconPlayArrow, IconPlus, IconClose } from '@arco-design/web-react/icon';
import { AGENT_MAP, IMAGE_RESOLUTIONS } from '../../../utils/film/agents';
import { IMAGE_MODEL_OPTIONS } from '../../../utils/film/suiteConfig';
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

// Thumbnail picker over the board's images — single (anchor/mood) or multi (refs).
// Picked ids persist in the settings; dead ids are skipped here and at run time.
const BoardImagePicker = ({ imageAssets, value, onPick, multi = false, emptyHint }) => {
  const picked = multi ? (value || []) : (value ? [value] : []);
  if (!imageAssets.length) {
    return <Text type="secondary" style={{ fontSize: 11, opacity: 0.8 }}>{emptyHint || 'No board images yet — generate or drop one first.'}</Text>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 176, overflowY: 'auto' }}>
      {imageAssets.map((a) => {
        const on = picked.includes(a.id);
        return (
          <div
            key={a.id}
            onClick={() => {
              if (multi) onPick(on ? picked.filter((x) => x !== a.id) : [...picked, a.id]);
              else onPick(on ? '' : a.id);
            }}
            title={a.label}
            style={{ position: 'relative', width: 54, height: 54, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: on ? '2px solid #165dff' : '2px solid transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1px #e5e6eb' }}
          >
            <img src={a.url} alt={a.label} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            {on && <div style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: '#165dff', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center' }}>✓</div>}
          </div>
        );
      })}
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
  <Select size="small" style={{ width: '100%' }} value={value || 'seedreamPro'} onChange={onChange}
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
      <InputNumber size="small" min={5} max={15} value={s.durationSec} onChange={(v) => up({ durationSec: v })} style={{ width: 90 }} suffix="s" />
    </div>
  </>
);

const StoryboardFields = ({ s, up, imageAssets }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Scene to board — empty = the selected Brief</Text>
      <Input.TextArea
        value={s.script || ''} onChange={(v) => up({ script: v })}
        placeholder="paste the scene or script — lands as a Brief card, verbatim"
        autoSize={{ minRows: 3, maxRows: 8 }}
      />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Output</Text>
      <Select size="small" style={{ width: '100%' }} value={s.mode || 'multiple'} onChange={(v) => up({ mode: v })}
        options={[{ label: 'Multiple images (keyframe grid)', value: 'multiple' }, { label: 'Single image (one storyboard sheet)', value: 'single' }]} />
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <div>
        <Text style={FIELD_LABEL}>Frames</Text>
        <InputNumber size="small" min={1} max={16} value={s.count} onChange={(v) => up({ count: v })} placeholder="8" style={{ width: 90 }} />
      </div>
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
      <Text style={FIELD_LABEL}>References (optional) — tick board images to anchor characters &amp; props</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.refs || []} onPick={(refs) => up({ refs })} multi
        emptyHint="Drop character / prop images on the board to use them as references." />
    </div>
  </>
);

const CastFields = ({ s, up }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Film idea — empty = the selected Brief</Text>
      <Input.TextArea
        value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
        placeholder="one sentence: what is this film about… e.g. 'a lighthouse keeper befriends the sea monster wrecking the ships'"
        autoSize={{ minRows: 3, maxRows: 6 }}
      />
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
      {(s.imageModel || 'seedreamPro') === 'seedreamPro' && (
        <Checkbox style={{ marginTop: 6 }} checked={!!s.imageThinking} onChange={(c) => up({ imageThinking: c })}>
          <Text type="secondary" style={{ fontSize: 12 }}>Prompt thinking — Pro reasons about each plate first (slower; text-to-image plates only)</Text>
        </Checkbox>
      )}
    </div>
  </>
);

const InspirationFields = ({ s, up, imageAssets }) => (
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
        emptyHint="No board images yet — the moods come from the prompt alone." />
      {(s.refs || []).length > 0 && (
        <Checkbox style={{ marginTop: 6 }} checked={!!s.useSelectionAsRefs} onChange={(c) => up({ useSelectionAsRefs: c })}>
          <Text type="secondary" style={{ fontSize: 12 }}>Also feed them to the image model as visual refs (not just the planner)</Text>
        </Checkbox>
      )}
    </div>
  </>
);

const VariationsFields = ({ agentId, s, up, imageAssets }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Source image — the {agentId === 'locationVariations' ? 'location' : 'character'} to vary</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.anchorId || ''} onPick={(anchorId) => up({ anchorId })}
        emptyHint="No board images yet — drop or generate the anchor first." />
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

const PrevizFields = ({ s, up, imageAssets }) => (
  <>
    <div>
      <Text style={FIELD_LABEL}>Scene text</Text>
      <Input.TextArea
        value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
        placeholder="paste anything — a brief, a sub-brief, or a layout idea: 'five people around a long dinner table, the matriarch at the head, two men standing'"
        autoSize={{ minRows: 4, maxRows: 10 }}
      />
    </div>
    <div>
      <Text style={FIELD_LABEL}>Camera (optional)</Text>
      <ShotTemplateSelect value={s.shotTemplate} onChange={(v) => up({ shotTemplate: v })} />
    </div>
    <Checkbox checked={!!s.imageThinking} onChange={(c) => up({ imageThinking: c })}>
      <Text type="secondary" style={{ fontSize: 12 }}>Prompt thinking — Pro reasons about the scene first (slower; ignored when references are ticked)</Text>
    </Checkbox>
    <div>
      <Text style={FIELD_LABEL}>References (optional) — tick board images to stage YOUR set; nothing is used unless ticked</Text>
      <BoardImagePicker imageAssets={imageAssets} value={s.refs || []} onPick={(refs) => up({ refs })} multi
        emptyHint="No board images yet — previz will invent the set from the text alone." />
    </div>
  </>
);

const AudioFields = ({ s, up, imageAssets }) => {
  const engine = s.model || 'seedAudio';
  const seedAudio = engine === 'seedAudio';
  return (
    <>
      <div>
        <Text style={FIELD_LABEL}>Engine</Text>
        <Select
          size="small" value={engine} onChange={(v) => up({ model: v })} style={{ width: '100%' }}
          options={[
            { label: 'Seed Audio 1.0 — prompt-driven: speech, ambience, SFX, whole scenes', value: 'seedAudio' },
            { label: 'Seed TTS 2.0 — reads your text verbatim in a fixed voice', value: 'seedTts' },
          ]}
        />
      </div>
      <div>
        <Text style={FIELD_LABEL}>
          {seedAudio ? 'Audio prompt — sent word for word; describe the voices, delivery and sounds you want (≤2048 chars, ≤120s of audio)' : 'Line to speak — spoken word for word, original language'}
        </Text>
        <Input.TextArea
          value={s.prompt || ''} onChange={(v) => up({ prompt: v })}
          placeholder={seedAudio ? 'a line to speak, an ambience, a sound effect, a whole radio scene…' : 'narration, a line read, a dialogue draft…'}
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      </div>
      {!seedAudio && (
        <div>
          <Text style={FIELD_LABEL}>Voice id</Text>
          <Input size="small" value={s.voice || ''} onChange={(v) => up({ voice: v })} placeholder="a BytePlus voice id, e.g. en_female_stokie_uranus_bigtts" />
        </div>
      )}
      {!seedAudio && (
        <div>
          <Text style={FIELD_LABEL}>Delivery direction (optional)</Text>
          <Input size="small" value={s.instruction || ''} onChange={(v) => up({ instruction: v })} placeholder="tone / emotion, e.g. 'a hushed, urgent whisper'" />
        </div>
      )}
      {seedAudio && (
        <div>
          <Text style={FIELD_LABEL}>Mood reference (optional) — one board image sets the scene</Text>
          <BoardImagePicker imageAssets={imageAssets} value={s.imageRef || ''} onPick={(imageRef) => up({ imageRef })} />
        </div>
      )}
    </>
  );
};

export const AGENT_FIELDS = {
  story: StoryFields,
  shot: ShotFields,
  storyboard: StoryboardFields,
  cast: CastFields,
  inspiration: InspirationFields,
  characterVariations: VariationsFields,
  locationVariations: VariationsFields,
  previz: PrevizFields,
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

const LayerPanel = ({ agentId, values, onChange, imageAssets = [], running, draft, onPrimary, onClose, apiKeyPresent }) => {
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
        {Body ? <Body agentId={agentId} s={s} up={onChange} imageAssets={imageAssets} /> : null}
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
