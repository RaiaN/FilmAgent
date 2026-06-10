import { useMemo, useRef } from 'react';
import { Button, Card, Input, Select, Tag, Typography } from '@arco-design/web-react';
import { IconDownload, IconSound } from '@arco-design/web-react/icon';

const { Text } = Typography;

// TTS 2.0 voices only
const VOICES = [
  {
    group: 'English',
    voices: [
      { name: 'Stokie', id: 'en_female_stokie_uranus_bigtts', gender: 'Female', style: 'Clear' },
      { name: 'Dacey',  id: 'en_female_dacey_uranus_bigtts',  gender: 'Female', style: 'Sweet' },
      { name: 'Tim',    id: 'en_male_tim_uranus_bigtts',       gender: 'Male',   style: 'Clear' },
    ],
  },
  {
    group: 'English & Chinese',
    voices: [
      { name: 'Kian',    id: 'zh_male_m191_uranus_bigtts',            gender: 'Male',   style: 'Clear'    },
      { name: 'Cedric',  id: 'zh_male_taocheng_uranus_bigtts',         gender: 'Male',   style: 'Clear'    },
      { name: 'Sophie',  id: 'zh_male_sophie_uranus_bigtts',           gender: 'Female', style: 'Clear'    },
      { name: 'Jean',    id: 'zh_female_yingyujiaoxue_uranus_bigtts',  gender: 'Female', style: 'Warm'     },
      { name: 'Magnus',  id: 'zh_male_dayi_uranus_bigtts',             gender: 'Male',   style: 'Clear'    },
      { name: 'Mabel',   id: 'zh_female_mizai_uranus_bigtts',          gender: 'Female', style: 'Sweet'    },
      { name: 'Nadia',   id: 'zh_female_jitangnv_uranus_bigtts',       gender: 'Female', style: 'Warm'     },
      { name: 'Opal',    id: 'zh_female_meilinvyou_uranus_bigtts',     gender: 'Female', style: 'Charming' },
      { name: 'Pearl',   id: 'zh_female_liuchangnv_uranus_bigtts',     gender: 'Female', style: 'Clear'    },
      { name: 'Quentin', id: 'zh_male_ruyayichen_uranus_bigtts',       gender: 'Male',   style: 'Warm'     },
    ],
  },
  {
    group: 'Mixed English & Chinese',
    voices: [
      { name: 'Vivi',    id: 'zh_female_vv_uranus_bigtts',              gender: 'Female', style: 'Vivid'  },
      { name: 'Vienna',  id: 'zh_female_vivo_uranus_bigtts',            gender: 'Female', style: 'Clear'  },
      { name: 'Alina',   id: 'zh_female_xiaoai_uranus_bigtts',          gender: 'Female', style: 'Clear'  },
      { name: 'Corinne', id: 'zh_female_cancan_uranus_bigtts',          gender: 'Female', style: 'Vivid'  },
      { name: 'Esther',  id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', gender: 'Female', style: 'Sweet'  },
      { name: 'Freya',   id: 'zh_female_tianmeitaozi_uranus_bigtts',    gender: 'Female', style: 'Sweet'  },
      { name: 'Gigi',    id: 'zh_female_shuangkuaisisi_uranus_bigtts',  gender: 'Female', style: 'Vivid'  },
      { name: 'Holly',   id: 'zh_female_peiqi_uranus_bigtts',           gender: 'Female', style: 'Cute'   },
      { name: 'Lyla',    id: 'zh_female_xiaoxue_uranus_bigtts',         gender: 'Female', style: 'Warm'   },
      { name: 'Daisy',   id: 'zh_female_yuanqi_uranus_bigtts',          gender: 'Female', style: 'Vivid'  },
      { name: 'Sandy',   id: 'zh_female_sajiaoxuemei_uranus_bigtts',    gender: 'Female', style: 'Sweet'  },
    ],
  },
  {
    group: 'Multi-language',
    voices: [
      { name: 'Mindy',  id: 'zh_female_xiaohe_uranus_bigtts',     gender: 'Female', style: 'Vivid', langs: 'EN/CN/ES/ID/PT' },
      { name: 'Jess',   id: 'zh_male_shaonianzixin_uranus_bigtts', gender: 'Male',   style: 'Vivid', langs: 'EN/CN/JP/ES/ID/PT' },
      { name: 'Pinky',  id: 'zh_female_linjianvhai_uranus_bigtts', gender: 'Female', style: 'Sweet', langs: 'EN/CN/ES/KR' },
      { name: 'Sweety', id: 'zh_female_kiwi_uranus_bigtts',        gender: 'Female', style: 'Vivid', langs: 'JP/ES' },
      { name: 'Tracy',  id: 'zh_female_kefunvsheng_uranus_bigtts', gender: 'Female', style: 'Warm',  langs: 'CN/ES' },
    ],
  },
  {
    group: 'Chinese',
    voices: [
      { name: 'Bonnie',      id: 'zh_female_dabing_uranus_bigtts',        gender: 'Female', style: 'Clear' },
      { name: 'Felix',       id: 'zh_male_liufei_uranus_bigtts',          gender: 'Male',   style: 'Clear' },
      { name: 'Celeste',     id: 'zh_female_qingxinnvsheng_uranus_bigtts',gender: 'Female', style: 'Clear' },
      { name: 'Monkey King', id: 'zh_male_sunwukong_uranus_bigtts',       gender: 'Male',   style: 'Clear' },
    ],
  },
  {
    group: 'International',
    voices: [
      { name: 'Sven',    id: 'de_male_seven_uranus_bigtts',   gender: 'Male',   style: 'Clear', langs: 'German'     },
      { name: 'Minimi',  id: 'jp_female_minimi_uranus_bigtts',gender: 'Female', style: 'Clear', langs: 'Japanese'   },
      { name: 'Usseau',  id: 'fr_male_usseau_uranus_bigtts',  gender: 'Male',   style: 'Clear', langs: 'French'     },
      { name: 'Felipe',  id: 'es_male_felipe_uranus_bigtts',  gender: 'Male',   style: 'Clear', langs: 'Spanish'    },
      { name: 'Han',     id: 'id_male_han_uranus_bigtts',     gender: 'Male',   style: 'Clear', langs: 'Indonesian' },
      { name: 'Martins', id: 'pt_male_martins_uranus_bigtts', gender: 'Male',   style: 'Clear', langs: 'Portuguese' },
      { name: 'Enzo',    id: 'it_male_enzo_uranus_bigtts',    gender: 'Male',   style: 'Clear', langs: 'Italian'    },
      { name: '지훈',    id: 'kr_male_shane_uranus_bigtts',   gender: 'Male',   style: 'Clear', langs: 'Korean'     },
    ],
  },
];

const FORMATS = ['mp3', 'ogg_opus', 'pcm'];
const SAMPLE_RATES = [8000, 16000, 24000, 48000];

function Field({ label, badge, children }) {
  return (
    <div className="field" style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 500 }}>
        {label}
        {badge && <Tag size="small" color="arcoblue" style={{ fontWeight: 400 }}>{badge}</Tag>}
      </label>
      {children}
    </div>
  );
}

export default function SpeechPlayground({ formValues, setFormValues, onSubmit, loading, result }) {
  const audioBlobRef = useRef(null);

  const set = (key, value) => setFormValues((prev) => ({ ...prev, [key]: value }));

  const audioUrl = useMemo(() => {
    if (!result?.audioBase64) return null;
    if (audioBlobRef.current) URL.revokeObjectURL(audioBlobRef.current);
    const bytes = Uint8Array.from(atob(result.audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: result.mimeType || 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    audioBlobRef.current = url;
    return url;
  }, [result?.audioBase64]);

  const handleDownload = () => {
    if (!audioUrl || !result) return;
    const ext = result.format === 'ogg_opus' ? 'ogg' : result.format || 'mp3';
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `speech-${Date.now()}.${ext}`;
    a.click();
  };

  return (
    <div>
      <Card>
        <Field label="Voice">
          <Select
            value={formValues.speaker || undefined}
            onChange={(v) => set('speaker', v)}
            placeholder="Select a voice..."
            showSearch
            style={{ width: '100%' }}
          >
            {VOICES.map(({ group, voices }) => (
              <Select.OptGroup key={group} label={group}>
                {voices.map(({ name, id, gender, style, langs }) => (
                  <Select.Option key={id} value={id}>
                    {name} · {gender} · {style}{langs ? ` · ${langs}` : ''}
                  </Select.Option>
                ))}
              </Select.OptGroup>
            ))}
          </Select>
        </Field>

        <Field label="Text to Synthesize">
          <Input.TextArea
            value={formValues.text || ''}
            onChange={(v) => set('text', v)}
            placeholder="Enter text to synthesize..."
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Format">
            <Select value={formValues.format || 'mp3'} onChange={(v) => set('format', v)} style={{ width: '100%' }}>
              {FORMATS.map((f) => <Select.Option key={f} value={f}>{f}</Select.Option>)}
            </Select>
          </Field>
          <Field label="Sample Rate (Hz)">
            <Select value={formValues.sampleRate || 24000} onChange={(v) => set('sampleRate', v)} style={{ width: '100%' }}>
              {SAMPLE_RATES.map((r) => <Select.Option key={r} value={r}>{r} Hz</Select.Option>)}
            </Select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Speech Rate (−50 to 100)">
            <Input
              type="number"
              value={formValues.speechRate ?? 0}
              onChange={(v) => set('speechRate', Number(v))}
              placeholder="0"
            />
          </Field>
          <Field label="Loudness (−50 to 100)">
            <Input
              type="number"
              value={formValues.loudnessRate ?? 0}
              onChange={(v) => set('loudnessRate', Number(v))}
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="Context / Style Direction" badge="TTS 2.0">
          <Input.TextArea
            value={formValues.contextText || ''}
            onChange={(v) => set('contextText', v)}
            placeholder={'Natural language instructions for tone or emotion, e.g. "Speak with a warm, enthusiastic tone."'}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </Field>

        <Button
          type="primary"
          icon={<IconSound />}
          onClick={onSubmit}
          loading={loading}
          disabled={!formValues.speaker || !formValues.text}
          style={{ marginTop: 4 }}
        >
          Synthesize Speech
        </Button>
      </Card>

      {result?.error && (
        <Card style={{ marginTop: 16 }}>
          <Text type="error" style={{ fontWeight: 500 }}>{typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}</Text>
          {result.details && (
            <pre style={{ fontSize: 12, marginTop: 8, color: '#86909c', whiteSpace: 'pre-wrap' }}>{typeof result.details === 'string' ? result.details : JSON.stringify(result.details, null, 2)}</pre>
          )}
        </Card>
      )}

      {audioUrl && !result?.error && (
        <Card style={{ marginTop: 16 }} title="Generated Audio">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} style={{ width: '100%' }} />
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button icon={<IconDownload />} onClick={handleDownload}>Download</Button>
            {result.size > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {(result.size / 1024).toFixed(1)} KB · {result.format} · {result.sampleRate} Hz
              </Text>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
