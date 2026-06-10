import { useState, useEffect } from 'react';
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
import { AGENT_MAP, AXIS_OPTIONS, suggestCompositionDirection, suggestShotMotion, extractMusePrompt, IMAGE_RESOLUTIONS, IMAGE_RATIOS } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';

const { Text, Title, Paragraph } = Typography;

// Which settings field each agent fills from selected text card(s). Agents not
// listed here don't auto-pull text. Story Director has its own panel.
const PRIMARY_TEXT_FIELD = {
  inspiration: 'prompt',   // the generation prompt
  promptMuse: 'question',  // the focus directive
};

// Combine every selected text card into one string. For a Prompt Muse card we
// take only its "Prompt:" section (not the "What I see:" analysis); a plain note
// contributes its full text. Multiple cards are joined with blank lines.
const combineSelectedText = (selection) =>
  (selection || [])
    .filter((n) => n.data?.kind === 'text' && (n.data?.text || '').trim())
    .map((n) => extractMusePrompt(n.data.text))
    .filter(Boolean)
    .join('\n\n');

const SIZE_OPTIONS = ['1K', '2K', '4K'];

const RESOLUTION_OPTIONS = ['480p', '720p', '1080p'];
const RATIO_OPTIONS = ['adaptive', '16:9', '9:16', '4:3', '1:1', '21:9'];
const DURATION_OPTIONS = ['auto', 2, 4, 5, 10];

const CAMERA_OPTIONS = ['auto', 'static lock-off', 'slow push-in', 'slow pull-out', 'pan left', 'pan right', 'tilt up', 'tilt down', 'handheld follow', 'dolly in', 'crane up', 'orbit around subject'];
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

export const SettingsControls = ({ layer, settings, setSettings, selection, apiKey }) => {
  const update = (patch) => setSettings({ ...settings, ...patch });
  const [musing, setMusing] = useState(false);

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

  const askMuseForDirection = async () => {
    const images = (selection || []).filter((n) => n.data?.kind === 'image' && n.data?.url).map((n) => n.data.localUrl || n.data.url);
    if (images.length < 2) { Message.warning('Select at least two images first'); return; }
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ in the far-left sidebar)'); return; }
    setMusing(true);
    try {
      const suggestion = await suggestCompositionDirection({ apiKey: apiKey.trim(), images });
      if (suggestion) {
        update({ prompt: suggestion });
        Message.success('Prompt Muse filled the direction');
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setMusing(false);
    }
  };

  // Force-fill a field from the selected text card(s). For a Prompt Muse card we
  // take its "Prompt:" section, not the "What I see:" analysis; notes pass whole.
  const loadSelectedText = (field) => {
    const combined = combineSelectedText(selection);
    if (!combined) { Message.warning('Select a text card on the board first'); return; }
    update({ [field]: combined });
    Message.success('Loaded text from the selected card(s)');
  };

  const askMuseForMotion = async () => {
    const images = (selection || []).filter((n) => n.data?.kind === 'image' && n.data?.url).map((n) => n.data.localUrl || n.data.url);
    if (images.length === 0) { Message.warning('Select a keyframe first'); return; }
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ in the far-left sidebar)'); return; }
    setMusing(true);
    try {
      const suggestion = await suggestShotMotion({ apiKey: apiKey.trim(), images: [images[0]] });
      if (suggestion) {
        update({ motion: suggestion });
        Message.success('Prompt Muse suggested the motion');
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setMusing(false);
    }
  };

  if (layer.id === 'mixMatch') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Direction (optional)</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              loading={musing}
              onClick={askMuseForDirection}
              style={{ color: '#0fc6c2' }}
            >
              Suggest with Prompt Muse
            </Button>
          </div>
          <Input.TextArea
            value={settings.prompt || ''}
            onChange={(value) => update({ prompt: value })}
            placeholder="how to combine them… e.g. 'the woman seated at the workbench, holding the lantern, dusk light through the window'"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
        </div>
        <Space wrap>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Count</Text>
            <InputNumber min={1} max={8} value={settings.count} onChange={(v) => update({ count: v })} style={{ width: 70 }} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Resolution</Text>
            <Select value={settings.size || '2K'} onChange={(v) => update({ size: v })} style={{ width: 80 }} options={IMAGE_RESOLUTIONS.map((s) => ({ label: s, value: s }))} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Aspect</Text>
            <Select value={settings.ratio || '16:9'} onChange={(v) => update({ ratio: v })} style={{ width: 92 }} options={IMAGE_RATIOS.map((s) => ({ label: s, value: s }))} />
          </div>
        </Space>
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Tip: pick an <b>Aspect</b> that matches the intended shot (e.g. 16:9 or 21:9 for a wide film still, 9:16 for vertical) — the frame is rendered at that exact shape, so bodies aren't squashed to fit. All selected images are used as references.
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'promptMuse') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Anything specific to focus on? (optional)</Text>
            <Button
              size="mini"
              type="text"
              icon={<IconBulb />}
              disabled={!hasTextSel}
              onClick={() => loadSelectedText('question')}
              style={{ color: hasTextSel ? '#0fc6c2' : undefined }}
            >
              Use selected text
            </Button>
          </div>
          <Input.TextArea
            value={settings.question || ''}
            onChange={(value) => update({ question: value })}
            placeholder="e.g. 'how is the lighting done?' · 'what makes this feel expensive?' · leave blank for a full read"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
        <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
          Select an image or video, then Run — you'll get a craft read plus a ready-to-use prompt. Select a text card too and its content auto-fills the focus above (while it's empty).
        </Paragraph>
      </Space>
    );
  }

  if (layer.id === 'animate') {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Camera &amp; lens</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <MiniSelect label="Camera" value={settings.camera} onChange={(v) => update({ camera: v })} options={CAMERA_OPTIONS} />
            <MiniSelect label="Lens" value={settings.lens} onChange={(v) => update({ lens: v })} options={LENS_OPTIONS} />
            <MiniSelect label="Focal length" value={settings.focalLength} onChange={(v) => update({ focalLength: v })} options={FOCAL_OPTIONS} />
            <MiniSelect label="Aperture" value={settings.aperture} onChange={(v) => update({ aperture: v })} options={APERTURE_OPTIONS} />
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Motion (optional)</Text>
            <Button size="mini" type="text" icon={<IconBulb />} loading={musing} onClick={askMuseForMotion} style={{ color: '#0fc6c2' }}>
              Suggest with Prompt Muse
            </Button>
          </div>
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
          Tip: run Prompt Muse first, then select its text card — the prompt auto-fills here while the field is empty. Edit freely, or hit <b>Use selected text</b> to re-pull.
        </Paragraph>
      </Space>
    );
  }

  // character / location variations share the same control shape
  const axes = AXIS_OPTIONS[layer.id] || [];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>Axis</Text>
        <Select value={settings.axis} onChange={(v) => update({ axis: v })} style={{ width: 180 }} options={axes.map((a) => ({ label: a, value: a }))} />
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
        <Text type="secondary" style={{ fontSize: 12 }}>Director notes (optional)</Text>
        <Input.TextArea
          value={settings.notes || ''}
          onChange={(value) => update({ notes: value })}
          placeholder="constraints to hold across variations…"
          autoSize={{ minRows: 1, maxRows: 3 }}
        />
      </div>
    </Space>
  );
};

const LayerPanel = ({ layerId, settings, setSettings, selection, running, onRun, onClose, apiKeyPresent, apiKey }) => {
  const layer = AGENT_MAP[layerId];
  if (!layer) return null;

  const usableSelection = (selection || []).filter((n) => (layer.consumes || []).includes(n.data?.kind) && n.data?.url);
  const needsSelection = layer.needsSelection;
  const minSelection = layer.minSelection || 1;
  const selectionOk = !needsSelection || usableSelection.length >= minSelection;
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
        <Divider style={{ margin: '8px 0' }} />

        {needsSelection && (
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

        <SettingsControls layer={layer} settings={settings} setSettings={setSettings} selection={selection} apiKey={apiKey} />
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
          {running ? 'Generating…' : `Run ${layer.label}`}
        </Button>
      </div>
    </div>
  );
};

export default LayerPanel;
