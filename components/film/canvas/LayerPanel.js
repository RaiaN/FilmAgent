import { useEffect } from 'react';
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
  Message,
} from '@arco-design/web-react';
import { IconPlayArrow, IconClose, IconBulb } from '@arco-design/web-react/icon';
import { AGENT_MAP, IMAGE_RESOLUTIONS } from '../../../utils/film/agents';
import { CAMERA_MOVES } from '../../../utils/film/recipes';
import { agentIcon } from './agentIcons';

const { Text, Title, Paragraph } = Typography;

// Which settings field each agent fills from selected text card(s). Agents not
// listed here don't auto-pull text.
const PRIMARY_TEXT_FIELD = {
  inspiration: 'prompt',   // the generation prompt
  cast: 'prompt',          // the film idea to cast from
  story: 'prompt',         // the film idea to write key events from
  storyboard: 'prompt',    // a story/idea to storyboard (else the current Story card)
};

// Combine every selected Note card into one string (joined with blank lines).
const combineSelectedText = (selection) =>
  (selection || [])
    .filter((n) => n.data?.kind === 'text' && (n.data?.text || '').trim())
    .map((n) => String(n.data.text).trim())
    .filter(Boolean)
    .join('\n\n');

const SIZE_OPTIONS = IMAGE_RESOLUTIONS; // the tiers the API actually accepts (2K/3K/4K) — never a bare '1K', which it rejects

const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k'];
const RATIO_OPTIONS = ['adaptive', '16:9', '9:16', '4:3', '1:1', '21:9'];
const DURATION_OPTIONS = ['auto', 2, 4, 5, 10];

// Camera moves come from the suite-wide template registry (recipes.CAMERA_MOVES) —
// the Animate panel, the CUT cards and the Filming Loop share one vocabulary.
const LENS_OPTIONS = ['auto', 'clean spherical', 'anamorphic (oval bokeh + flares)', 'vintage uncoated', 'macro'];
const FOCAL_OPTIONS = ['auto', '14mm', '24mm', '35mm', '50mm', '85mm', '135mm'];
const APERTURE_OPTIONS = ['auto', 'f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/5.6', 'f/8'];

// Compact labeled select used in the cinematography grid.
const MiniSelect = ({ label, value, onChange, options }) => (
  <div style={{ flex: '1 1 46%', minWidth: 120 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{label}</Text>
    <Select size="small" value={value} onChange={onChange} style={{ width: '100%' }} options={options.map((o) => ({ label: o, value: o }))} />
  </div>
);

export const SettingsControls = ({ layer, settings, setSettings, selection }) => {
  const update = (patch) => setSettings({ ...settings, ...patch });

  const textField = PRIMARY_TEXT_FIELD[layer.id];
  const hasTextSel = (selection || []).some((n) => n.data?.kind === 'text' && (n.data?.text || '').trim());

  // Auto-populate the agent's text field from selected text card(s) — but only
  // while it's empty, so we never clobber what the user typed. Re-runs when the
  // selection or active agent changes; the manual button below can force-refill.
  useEffect(() => {
    if (!textField) return;
    if ((settings[textField] || '').trim()) return;
    const combined = combineSelectedText(selection);
    if (combined) update({ [textField]: combined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, textField]);

  // Force-fill a field from the selected Note card(s).
  const loadSelectedText = (field) => {
    const combined = combineSelectedText(selection);
    if (!combined) { Message.warning('Select a Note card on the board first'); return; }
    update({ [field]: combined });
    Message.success('Loaded text from the selected card(s)');
  };

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
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Seedance runs as a background task (~1–3 min). A loading shot appears on the board and fills in when ready.
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'cast') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Film idea</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              disabled={!hasTextSel}
              onClick={() => loadSelectedText('prompt')}
              style={{ color: hasTextSel ? '#0fc6c2' : undefined }}
            >
              Use selected text
            </Button>
          </div>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="one sentence: what is this film about… e.g. 'a lighthouse keeper befriends the sea monster wrecking the ships' — leave blank to use the project's idea"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Drafts 1–2 <b>characters</b> (people, animals or <b>monsters</b> — a 4K face plate + full-body sheet each) and 1–2 <b>locations</b>, all under one shared look, in the chosen genre. They land as candidates — tap the dashed role chip on the keepers to lock them into the bible, then re-roll the rest with Character / Location Variations.
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'story') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Film idea</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              disabled={!hasTextSel}
              onClick={() => loadSelectedText('prompt')}
              style={{ color: hasTextSel ? '#0fc6c2' : undefined }}
            >
              Use selected text
            </Button>
          </div>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="one sentence: what happens in this film… e.g. 'a lighthouse keeper befriends the sea monster wrecking the ships' — leave blank to use the project's idea"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Rewrites your idea (or pasted script) into <b>one long cinematic prompt</b> — clear subjects, a story arc, explicit eyelines. It does <b>not</b> use the board’s reference assets by default. Lands as an editable Story card (each Run adds a new one); <b>New Shot</b> turns it into a SHOT card.
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'inspiration') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Prompt</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              disabled={!hasTextSel}
              onClick={() => loadSelectedText('prompt')}
              style={{ color: hasTextSel ? '#0fc6c2' : undefined }}
            >
              Use selected text
            </Button>
          </div>
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
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Tip: add a <b>Note</b> on the board and select it — its text auto-fills the prompt here while the field is empty. Edit freely, or hit <b>Use selected text</b> to re-pull.
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'storyboard') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Story or idea</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              disabled={!hasTextSel}
              onClick={() => loadSelectedText('prompt')}
              style={{ color: hasTextSel ? '#0fc6c2' : undefined }}
            >
              Use selected text
            </Button>
          </div>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="a story or idea to storyboard… leave blank to use the current Story card"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Renders a <b>visual storyboard</b> — one frame per element, all <b>in one go</b> (one shared seed for consistency). Any board <b>images you select</b> ride as <b>references</b> (cast, world, mood) on every frame. Lands as a Storyboard panel. <i>(The Story node also has a 📋 button.)</i>
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'deconstruct') {
    return (
      <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
        Select a <b>Take</b> (a rendered shot) on the board, then Run. Seed 2.0 Pro watches it and breaks it into its cuts — <b>key-frame stills</b> for visual grounding + one editable <b>SHOT card per cut</b> (camera &amp; cinematography pre-filled; references left for you to populate). The bridge from a quick exploration Take to detailed, directed shots. <i>(The Take node also has its own ✂ Deconstruct button.)</i>
      </Paragraph>
    );
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
      <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
        Each variation is planned to be distinct by Seed 2.0 Pro, with identity{layer.id === 'locationVariations' ? '/architecture' : ''} preserved.
      </Paragraph>
    </Space>
  );
};

const LayerPanel = ({ layerId, settings, setSettings, selection, running, onRun, onClose, apiKeyPresent, clipMode, clipLabel, onClearClip }) => {
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon style={{ color: layer.color, fontSize: 18, flexShrink: 0 }} />
          <Title heading={6} style={{ margin: 0 }} ellipsis>{layer.label}</Title>
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
                select {minSelection >= 2 ? `at least ${minSelection} images` : (consumesVideo ? 'an image or video' : '1 image')} on the board
                {minSelection >= 2 && usableSelection.length === 1 ? ` (1 so far)` : ''}
              </Tag>
            )}
          </div>
        )}

        <SettingsControls layer={layer} settings={settings} setSettings={setSettings} selection={selection} />
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
