import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Select, Typography } from '@arco-design/web-react';
import {
  IconClose,
  IconPause,
  IconPlayArrow,
  IconCamera,
  IconToLeft,
  IconToRight,
  IconLeft,
  IconRight,
  IconFile,
  IconSound,
  IconRefresh,
} from '@arco-design/web-react/icon';

const { Text } = Typography;

const FRAME = 1 / 24; // one film frame — the step unit for ←/→
const RATES = [0.25, 0.5, 1];

const fmt = (t) => {
  const s = Math.max(0, Number(t) || 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

// The TAKE VIEWER — a simple video viewer/editor over ANY board video (takes, animate
// outputs, uploads): scrub, frame-step, slow-play, then turn the playhead into board
// assets — 📷 the exact frame (server ffmpeg, free), ⏮/⏭ first/last frame, 📝 a
// prompt-ready text NOTE (one explicit VLM tap), 🎧 the audio track. Opened from the
// ▶ button on a video node; nothing runs on open.
const TakeViewer = ({ src, title, busy, onClose, onExtractFrame, onFirstFrame, onLastFrame, onDescribe, onExtractAudio }) => {
  const videoRef = useRef(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);

  // Smooth playhead: rAF while playing (timeupdate alone is ~4Hz and stutters the scrubber).
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      const v = videoRef.current;
      if (v) setT(v.currentTime || 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((next) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.min(Math.max(0, next), v.duration || next);
    v.currentTime = clamped;
    setT(clamped);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); } else { v.pause(); }
  }, []);

  const step = useCallback((frames) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seek((v.currentTime || 0) + frames * FRAME);
  }, [seek]);

  // Keyboard transport: Space play/pause, ←/→ frame-step (Shift = 1s), Esc close.
  const onKeyDown = useCallback((e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -24 : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 24 : 1); }
    else if (e.key === 'Escape' && !busy) onClose();
  }, [togglePlay, step, busy, onClose]);

  const act = (key, fn) => () => { const v = videoRef.current; if (v) v.pause(); fn(); };
  const actionBtn = (key, icon, label, tip, fn) => (
    <Button
      size="small"
      icon={busy === key ? <IconRefresh spin /> : icon}
      disabled={!!busy && busy !== key}
      loading={busy === key}
      onClick={act(key, fn)}
      title={tip}
    >
      {label}
    </Button>
  );

  return (
    <div
      role="dialog"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      ref={(el) => { if (el) el.focus(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(12,14,18,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(880px, 94vw)', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,0.35)' }}>
        <div style={{ height: 4, background: '#0fc6c2' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f2f3f5' }}>
          <Text bold style={{ fontSize: 13, flex: 1 }} ellipsis>🎞 {title || 'Take'}</Text>
          <Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {fmt(t)} / {fmt(duration)}
          </Text>
          <Button size="mini" type="text" icon={<IconClose />} onClick={() => { if (!busy) onClose(); }} />
        </div>

        <div style={{ background: '#000', display: 'flex', justifyContent: 'center' }}>
          {/* No native controls — the transport below owns the playhead. */}
          <video
            ref={videoRef}
            src={src}
            loop={loop}
            playsInline
            preload="auto"
            style={{ width: '100%', maxHeight: '58vh', display: 'block' }}
            onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
            onDurationChange={(e) => setDuration(e.target.duration || 0)}
            onTimeUpdate={(e) => { if (!playing) setT(e.target.currentTime || 0); }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={togglePlay}
          />
        </div>

        {/* Transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
          <Button size="small" shape="circle" type="primary" icon={playing ? <IconPause /> : <IconPlayArrow />} onClick={togglePlay} title="Play / pause (Space)" style={{ background: '#0fc6c2', borderColor: '#0fc6c2', flexShrink: 0 }} />
          <Button size="mini" icon={<IconLeft />} onClick={() => step(-1)} title="Back one frame — 1/24s (←; Shift+← = 1s)" style={{ flexShrink: 0 }} />
          <Button size="mini" icon={<IconRight />} onClick={() => step(1)} title="Forward one frame — 1/24s (→; Shift+→ = 1s)" style={{ flexShrink: 0 }} />
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.001}
            value={Math.min(t, duration || t)}
            onChange={(e) => { const v = videoRef.current; if (v) v.pause(); seek(Number(e.target.value)); }}
            style={{ flex: 1, accentColor: '#0fc6c2' }}
          />
          <Select size="mini" value={rate} onChange={(v) => { setRate(v); const el = videoRef.current; if (el) el.playbackRate = v; }} options={RATES.map((r) => ({ label: `${r}×`, value: r }))} style={{ width: 74, flexShrink: 0 }} triggerProps={{ autoAlignPopupWidth: false }} />
          <Button size="mini" type={loop ? 'primary' : 'outline'} onClick={() => setLoop((l) => !l)} title={loop ? 'Looping — click to play once' : 'Play once — click to loop'} style={loop ? { background: '#0fc6c2', borderColor: '#0fc6c2', flexShrink: 0 } : { flexShrink: 0 }}>
            loop
          </Button>
        </div>

        {/* Playhead → board actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px 12px', flexWrap: 'wrap' }}>
          {actionBtn('frame', <IconCamera />, 'Frame → board', 'Extract the EXACT playhead frame (server ffmpeg, free) — it lands beside the take as a normal image: mask, edit, tag or attach it.', () => onExtractFrame(t))}
          {actionBtn('first', <IconToLeft />, 'First frame', 'Extract the very first frame — the shot\'s opening composition.', onFirstFrame)}
          {actionBtn('last', <IconToRight />, 'Last frame', 'Extract the very last frame — the continuity seed for the next shot.', onLastFrame)}
          {actionBtn('describe', <IconFile />, 'Describe → note', 'ONE Seed 2.0 Pro vision call: reads the playhead frame → subjects, blocking, setting, camera, light — lands as an editable text note beside the take.', () => onDescribe(t))}
          {actionBtn('audio', <IconSound />, 'Audio → board', 'Extract the take\'s audio track (server ffmpeg, free) — lands as a playable clip: audition it or ★ it as a SHOT-card audio reference.', () => onExtractAudio(duration))}
        </div>
      </div>
    </div>
  );
};

export default TakeViewer;
