import {
  Button,
  Input,
  InputNumber,
  Select,
  Checkbox,
  Space,
  Typography,
  Tag,
  Divider,
} from '@arco-design/web-react';
import { IconPlayArrow, IconClose } from '@arco-design/web-react/icon';
import { AGENT_MAP, IMAGE_RESOLUTIONS } from '../../../utils/film/agents';
import { IMAGE_MODEL_OPTIONS } from '../../../utils/film/suiteConfig';
import { CAMERA_MOVES, SHOT_TEMPLATES_BY_CATEGORY } from '../../../utils/film/recipes';
import { agentIcon } from './agentIcons';

const { Text, Title, Paragraph } = Typography;

const SIZE_OPTIONS = IMAGE_RESOLUTIONS; // the tiers the API actually accepts (2K/3K/4K) — never a bare '1K', which it rejects

const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k'];
const RATIO_OPTIONS = ['adaptive', '16:9', '9:16', '4:3', '1:1', '21:9'];
const DURATION_OPTIONS = ['auto', 2, 4, 5, 10];

// Camera moves come from the suite-wide template registry (recipes.CAMERA_MOVES) —
// the Animate panel, the CUT cards and the Filming Loop share one vocabulary.
const LENS_OPTIONS = ['auto', 'clean spherical', 'anamorphic (oval bokeh + flares)', 'vintage uncoated', 'macro'];
const FOCAL_OPTIONS = ['auto', '14mm', '24mm', '35mm', '50mm', '85mm', '135mm'];
const APERTURE_OPTIONS = ['auto', 'f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/5.6', 'f/8'];
// Storyboard consistency lever — the customer's race-drift fix. Free-typeable (allowCreate).
const ETHNICITY_OPTIONS = ['Unspecified', 'South Asian', 'East Asian', 'Southeast Asian', 'Black / African', 'White / Caucasian', 'Hispanic / Latino', 'Middle Eastern', 'Indigenous', 'Mixed'];
// Storyboard look — feeds keyframe line 1. Auto = the shot division picks a fitting aesthetic.
const STYLE_OPTIONS = ['Auto', 'photo-real', 'cinematic', 'retro', 'noir', 'anime', 'comic / graphic novel', 'watercolor', 'documentary'];

// Compact labeled select used in the cinematography grid.
const MiniSelect = ({ label, value, onChange, options }) => (
  <div style={{ flex: '1 1 46%', minWidth: 120 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{label}</Text>
    <Select size="small" value={value} onChange={onChange} style={{ width: '100%' }} options={options.map((o) => ({ label: o, value: o }))} />
  </div>
);

export const SettingsControls = ({ layer, settings, setSettings, imageAssets = [] }) => {
  const update = (patch) => setSettings({ ...settings, ...patch });

  if (layer.id === 'animate') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Camera &amp; lens</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <MiniSelect label="Camera" value={settings.camera} onChange={(v) => update({ camera: v })} options={CAMERA_MOVES} />
            <MiniSelect label="Lens" value={settings.lens} onChange={(v) => update({ lens: v })} options={LENS_OPTIONS} />
            <MiniSelect label="Focal length" value={settings.focalLength} onChange={(v) => update({ focalLength: v })} options={FOCAL_OPTIONS} />
            <MiniSelect label="Aperture" value={settings.aperture} onChange={(v) => update({ aperture: v })} options={APERTURE_OPTIONS} />
          </div>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Motion (optional)</Text>
          <Input.TextArea
            value={settings.motion || ''}
            onChange={(value) => update({ motion: value })}
            placeholder="what moves in the shot… e.g. 'the cat blinks and tilts its head, steam drifts, subtle rim-light flicker'"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
        </div>
        <Space wrap>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Duration</Text>
            <Select value={settings.duration} onChange={(v) => update({ duration: v })} style={{ width: 100 }} options={DURATION_OPTIONS.map((d) => ({ label: d === 'auto' ? 'auto' : `${d}s`, value: d }))} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Resolution</Text>
            <Select value={settings.resolution} onChange={(v) => update({ resolution: v })} style={{ width: 100 }} options={RESOLUTION_OPTIONS.map((r) => ({ label: r, value: r }))} />
          </div>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Aspect ratio</Text>
          <Select value={settings.ratio} onChange={(v) => update({ ratio: v })} style={{ width: 130 }} options={RATIO_OPTIONS.map((r) => ({ label: r, value: r }))} />
        </div>
        <Checkbox checked={settings.generateAudio} onChange={(c) => update({ generateAudio: c })}>
          <Text style={{ fontSize: 12 }}>Generate native audio</Text>
        </Checkbox>
      </Space>
    );
  }

  if (layer.id === 'shot') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Shot description (optional)</Text>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="what happens in the shot… or leave blank and write it on the card"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Camera preset</Text>
          <Select
            size="small"
            value={settings.shotTemplate || undefined}
            placeholder="cinematography…"
            onChange={(v) => update({ shotTemplate: v })}
            style={{ width: '100%' }}
            showSearch
            filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.toLowerCase())}
          >
            {SHOT_TEMPLATES_BY_CATEGORY.map(({ category, templates }) => (
              <Select.OptGroup key={category} label={category}>
                {templates.map((t) => <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>)}
              </Select.OptGroup>
            ))}
          </Select>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Duration</Text>
          <InputNumber min={5} max={15} value={settings.durationSec} onChange={(v) => update({ durationSec: v })} style={{ width: 90 }} suffix="s" />
        </div>
      </Space>
    );
  }

  if (layer.id === 'cast') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Film idea</Text>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="one sentence: what is this film about… e.g. 'a lighthouse keeper befriends the sea monster wrecking the ships' — leave blank to use the project's idea"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Image model</Text>
          <Select size="small" style={{ width: '100%' }} value={settings.imageModel || 'seedream'} onChange={(v) => update({ imageModel: v })}
            options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))} />
        </div>
      </Space>
    );
  }

  if (layer.id === 'story') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Your brief</Text>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="an idea, a description or a full script — lands on the board VERBATIM as a Brief card (leave blank for an empty card to type into)"
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </div>
      </Space>
    );
  }

  if (layer.id === 'inspiration') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Prompt</Text>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="mood, era, palette, references… e.g. 'cold war Arctic outpost, 16mm, desaturated teal'"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <Space>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Count</Text>
            <InputNumber min={1} max={12} value={settings.count} onChange={(v) => update({ count: v })} style={{ width: 80 }} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Size</Text>
            <Select value={settings.size} onChange={(v) => update({ size: v })} style={{ width: 90 }} options={SIZE_OPTIONS.map((s) => ({ label: s, value: s }))} />
          </div>
        </Space>
        <Checkbox checked={settings.useSelectionAsRefs} onChange={(c) => update({ useSelectionAsRefs: c })}>
          <Text style={{ fontSize: 12 }}>Seed with selected images as style refs</Text>
        </Checkbox>
      </Space>
    );
  }

  if (layer.id === 'storyboard') {
    const refs = settings.refs || [];
    const toggleRef = (id) => update({ refs: refs.includes(id) ? refs.filter((x) => x !== id) : [...refs, id] });
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Output</Text>
          <Select size="small" style={{ width: '100%' }} value={settings.mode || 'multiple'} onChange={(v) => update({ mode: v })}
            options={[{ label: 'Multiple images (keyframe grid)', value: 'multiple' }, { label: 'Single image (one storyboard sheet)', value: 'single' }]} />
        </div>
        <Space>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Frames</Text>
            <InputNumber min={1} max={16} value={settings.count} onChange={(v) => update({ count: v })} placeholder="8" style={{ width: 90 }} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Style</Text>
            <Select allowCreate size="small" style={{ width: 150 }} placeholder="Auto"
              value={settings.style || undefined} onChange={(v) => update({ style: v })}
              options={STYLE_OPTIONS.map((s) => ({ label: s, value: s }))} />
          </div>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Image model</Text>
          <Select size="small" style={{ width: '100%' }} value={settings.imageModel || 'seedream'} onChange={(v) => update({ imageModel: v })}
            options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Ethnicity (optional) — keeps characters from drifting</Text>
          <Select allowCreate allowClear size="small" style={{ width: '100%' }} placeholder="Unspecified"
            value={settings.ethnicity || undefined} onChange={(v) => update({ ethnicity: v })}
            options={ETHNICITY_OPTIONS.map((e) => ({ label: e, value: e }))} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>References (optional) — tick board images to anchor characters &amp; props</Text>
          {imageAssets.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 11, opacity: 0.7 }}>Drop character / prop images on the board to use them as references.</Text>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 176, overflowY: 'auto' }}>
              {imageAssets.map((a) => {
                const on = refs.includes(a.id);
                return (
                  <div key={a.id} onClick={() => toggleRef(a.id)} title={a.label}
                    style={{ position: 'relative', width: 54, height: 54, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: on ? '2px solid #165dff' : '2px solid transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1px #e5e6eb' }}>
                    <img src={a.url} alt={a.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {on && <div style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: '#165dff', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center' }}>✓</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Space>
    );
  }

  if (layer.id === 'previz') {
    const refs = settings.refs || [];
    const toggleRef = (id) => update({ refs: refs.includes(id) ? refs.filter((x) => x !== id) : [...refs, id] });
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Scene text</Text>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="paste anything — a brief, a sub-brief, or a layout idea: 'five people around a long dinner table, the matriarch at the head, two men standing'"
            autoSize={{ minRows: 4, maxRows: 10 }}
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Camera (optional)</Text>
          <Select size="small" style={{ width: '100%' }} placeholder="let the model choose" allowClear showSearch
            value={settings.shotTemplate || undefined} onChange={(v) => update({ shotTemplate: v || '' })}
            filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.toLowerCase())}>
            {SHOT_TEMPLATES_BY_CATEGORY.map(({ category, templates }) => (
              <Select.OptGroup key={category} label={category}>
                {templates.map((t) => <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>)}
              </Select.OptGroup>
            ))}
          </Select>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>References (optional) — tick board images to stage YOUR set; nothing is used unless ticked</Text>
          {imageAssets.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 11, opacity: 0.7 }}>No board images yet — previz will invent the set from the text alone.</Text>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 176, overflowY: 'auto' }}>
              {imageAssets.map((a) => {
                const on = refs.includes(a.id);
                return (
                  <div key={a.id} onClick={() => toggleRef(a.id)} title={a.label}
                    style={{ position: 'relative', width: 54, height: 54, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: on ? '2px solid #165dff' : '2px solid transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1px #e5e6eb' }}>
                    <img src={a.url} alt={a.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {on && <div style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: '#165dff', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center' }}>✓</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Space>
    );
  }

  if (layer.id === 'deconstruct') {
    return null; // no settings — the describe + the "select a video" tag say it all
  }

  // character / location variations share the same control shape
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>Direction (optional)</Text>
        <Input.TextArea
          value={settings.direction || ''}
          onChange={(value) => update({ direction: value })}
          placeholder={layer.id === 'locationVariations'
            ? "what to explore… e.g. 'different times of day', 'tighter angles', 'in winter' — or leave blank and the agent decides"
            : "what to explore… e.g. 'different wardrobes', 'across ages', 'range of expressions' — or leave blank and the agent decides"}
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
      </div>
      <Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Count</Text>
          <InputNumber min={1} max={8} value={settings.count} onChange={(v) => update({ count: v })} style={{ width: 80 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Size</Text>
          <Select value={settings.size} onChange={(v) => update({ size: v })} style={{ width: 90 }} options={SIZE_OPTIONS.map((s) => ({ label: s, value: s }))} />
        </div>
      </Space>
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Image model</Text>
        <Select size="small" style={{ width: '100%' }} value={settings.imageModel || 'seedream'} onChange={(v) => update({ imageModel: v })}
          options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))} />
      </div>
    </Space>
  );
};

const LayerPanel = ({ layerId, settings, setSettings, selection, imageAssets = [], running, onRun, onClose, apiKeyPresent, clipMode, clipLabel, onClearClip }) => {
  const layer = AGENT_MAP[layerId];
  if (!layer) return null;

  const usableSelection = (selection || []).filter((n) => (layer.consumes || []).includes(n.data?.kind) && n.data?.url);
  const needsSelection = layer.needsSelection;
  const minSelection = layer.minSelection || 1;
  // In clip mode the clip's beat + bible provide the context, so a board selection
  // isn't required (any selected images just become extra references).
  const selectionOk = clipMode || !needsSelection || usableSelection.length >= minSelection;
  const canRun = apiKeyPresent && selectionOk && !running;
  const consumesVideo = (layer.consumes || []).includes('video');

  const Icon = agentIcon(layer.icon);
  return (
    <div style={{ width: 300, borderLeft: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4, background: layer.color }} />
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <Icon style={{ color: layer.color, fontSize: 18, flexShrink: 0 }} />
          <Title heading={6} style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.label}</Title>
        </span>
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>
      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>{layer.describe}</Paragraph>

        {clipMode && (
          <div style={{ padding: 8, borderRadius: 6, background: '#fffdf5', border: '1px solid #f7ba1e', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: 600, color: '#b8860b' }}>🎬 Filling {clipLabel}</Text>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
              {layerId === 'animate'
                ? 'Renders this clip from its keyframe (its beat steers the motion).'
                : "Generates this clip's keyframe — its beat is the prompt, the bible its references."}
            </Text>
            <Button size="mini" type="text" onClick={onClearClip} style={{ padding: 0, height: 'auto', fontSize: 11 }}>← run on the board instead</Button>
          </div>
        )}

        <Divider style={{ margin: '8px 0' }} />

        {needsSelection && !clipMode && (
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Selected: </Text>
            {selectionOk && usableSelection.length > 0 ? (
              <Tag color={layer.color === '#00b42a' ? 'green' : 'arcoblue'}>{usableSelection.length} {usableSelection.length > 1 ? 'assets' : 'asset'} selected</Tag>
            ) : (
              <Tag color="red">
                select {minSelection >= 2 ? `at least ${minSelection} images` : (consumesVideo ? 'a Take (a rendered video)' : '1 image')} on the board
                {minSelection >= 2 && usableSelection.length === 1 ? ` (1 so far)` : ''}
              </Tag>
            )}
          </div>
        )}

        <SettingsControls layer={layer} settings={settings} setSettings={setSettings} imageAssets={imageAssets} />
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #f2f3f5' }}>
        {!apiKeyPresent && (
          <Text type="error" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>Add your API key first — click the ⚙ gear in the far-left sidebar.</Text>
        )}
        <Button
          type="primary"
          long
          icon={<IconPlayArrow />}
          loading={running}
          disabled={!canRun}
          onClick={onRun}
          style={{ background: canRun ? layer.color : undefined, borderColor: canRun ? layer.color : undefined }}
        >
          {running ? (clipMode ? 'Filling clip…' : 'Generating…') : (clipMode ? 'Fill this clip' : `Run ${layer.label}`)}
        </Button>
      </div>
    </div>
  );
};

export default LayerPanel;
