import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  SelectionMode,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Message, Space, Typography, Tooltip, Modal, Input } from '@arco-design/web-react';
import {
  IconRefresh,
  IconPlus,
  IconZoomIn,
  IconZoomOut,
  IconFullscreen,
  IconStorage,
  IconHistory,
  IconArchive,
  IconVideoCamera,
} from '@arco-design/web-react/icon';
import AssetNode, { AssetNodeContext } from './AssetNode';
import CutNode, { CutContext } from './CutNode';
import GroupNode from './GroupNode';
import StoryScriptNode, { StoryScriptContext } from './StoryScriptNode';
import StoryboardChatNode, { StoryboardChatContext } from './StoryboardChatNode';
import StoryboardStripNode from './StoryboardStripNode';
import NoteNode, { NoteContext } from './NoteNode';
import TakeViewer from './TakeViewer';
import TakeLibrary from './TakeLibrary';
import RefDrawer from './RefDrawer';
import ContinuityEdge from './ContinuityEdge';
import SequenceNode, { SequenceContext } from './SequenceNode';
import KeyframeEditor from './KeyframeEditor';
import PlateCastEditor from './PlateCastEditor';
import LayerRail from './LayerRail';
import AgentNode, { AgentNodeContext } from './AgentNode';
import LayerPanel from './LayerPanel';
import CanvasContextMenu from './CanvasContextMenu';
import LibraryPanel from './LibraryPanel';
import StoryTimeline from './StoryTimeline';
import FilmDock from './FilmDock';
import PipelineStrip from './PipelineStrip';
import HistoryPanel from './HistoryPanel';
import { AGENT_MAP, AGENTS, castAgent, createBrowserTransport, classifyAssets } from '../../../utils/film/agents';
import { createProduction } from '../../../utils/film/core/production';
import { animate as animateOp, generateFilmAudio } from '../../../utils/film/core/operations';
import { detectGenre, writeFilmPrompt, describeFrame, storyboardCarve, storyboardAuthor, storyboardKeyframe, storyboardEndframe, storyboardSheet, storyboardShotBody, storyboardQuickPage, composeShotAction, enrichShotAction, directShotAction, enhanceStill, splitIntoShots, maskFrame, floorPlan, projectShot } from '../../../utils/film/core/storyboard';
import { runWithConcurrency } from '../../../utils/film/core/parallel';
import { clampResolution, maxShotSeconds, videoModelKeyOf, defaultVideoModelKey, defaultImageModelKey, imageModelKeyOf, videoTraits } from '../../../utils/film/suiteConfig';
import { pipelineStatus } from '../../../utils/film/pipeline';
import { routeStudioAction } from '../../../utils/film/core/director';
import { createBrowserClient } from '../../../utils/film/core/client';
import { createTrace } from '../../../utils/film/core/trace';
import { emptyTimeline, emptyBible } from '../../../utils/film/projectShape';
import { bibleEntry, timelineEvent, orderedEvents, renumber, mirrorSessionEvents } from '../../../utils/film/timelineModel';
import { BIBLE_ROLES, SHORT_FILM_RECIPE, composeFilmShotPrompt, composePinnedShotPrompt, shotReferences, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import {
  createAssetNode,
  originFromSelection,
  fileToAssetKind,
  readFileAsDataUrl,
  serializeNodes,
  preserveAsset,
  resignAsset,
  findFreeOrigin,
  stageLocalAsset,
  makeThumbnail,
  createGroupNode,
} from '../../../utils/film/canvasModel';
import { listLibrary, addToLibrary, deleteFromLibrary, clearLibrary as clearLibraryStore, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';
import { isLocalMediaUrl, absLocalMediaUrl } from '../../../utils/film/mediaUrl';
import { buildDemoSteps } from '../../../utils/film/demoScript';

const { Text } = Typography;

const nodeTypes = { asset: AssetNode, group: GroupNode, cut: CutNode, story: StoryScriptNode, sbchat: StoryboardChatNode, sbstrip: StoryboardStripNode, agent: AgentNode, note: NoteNode, sequence: SequenceNode };
const edgeTypes = { continuity: ContinuityEdge };

const CELL_W = 240;
const CELL_H = 290;
const GROUP_PAD = 12;
const GROUP_HEADER = 34;

// SHOT cards are 500px wide and TALL — the prompt + cinematography + audio + params +
// references run ~600–700px. Tile on a generous pitch so rows never collide.
const CUT_COL_W = 820; // SHOT card node width (780) + gutter — drives every card-laying grid
const CUT_ROW_H = 760;
// The color-binding line a blocking plate drops into a SHOT card's prompt on attach —
// plain editable text; the user corrects the [Image N] numbers to the reference badges.
// The FIRST FRAME lock inserted when an anchor image (promoted keyframe / blocking
// plate) attaches to a SHOT card — PREPENDED, so the shot's very FIRST instruction is
// the frame lock (Seedance weights the opening hard). `plateNum` = the image's actual
// [Image N] badge at attach time (enabled bible refs first, then per-shot assets).
// `mask` adds the silhouette color→character bindings (an editable guess);
// Duplicate edge ids = duplicate React keys = React Flow silently renders NOTHING.
// Every edge write (runtime AND hydration — a saved manifest may already carry dups)
// funnels through this.
const dedupeEdgeList = (es) => { const seen = new Set(); return es.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))); };

const anchorBindingLine = (plateNum, { mask = true, cast = [] } = {}) => {
  const lock = `FIRST FRAME: STRICTLY FOLLOW [Image ${plateNum}] — preserve its camera angle, framing and figure positions exactly.`;
  let bind = '';
  if (cast.length) {
    // Colors were CAST on the plate → name each character with its REAL badge number.
    const parts = cast.map((c) => `the ${c.color} silhouette is ${c.name} — [Image ${c.badge}]`);
    const s = `${parts.join('; ')}${mask && cast.length < 5 ? '; any remaining silhouettes are background figures' : ''}. Real people occupy those positions — no flat silhouettes in the output.`;
    bind = ` ${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  } else if (mask) {
    bind = ` The BLUE silhouette is [Image 1]'s character, GREEN is [Image 2]'s, YELLOW [Image 3]'s, RED [Image 4]'s, PURPLE [Image 5]'s (adjust the numbers to your reference badges). Real people occupy those positions — no flat silhouettes in the output.`;
  }
  return `${lock}${bind}`;
};
// A prompt already carrying a lock (old wording said 'silhouette') never gets a second one.
const hasFrameLock = (prompt) => /FIRST FRAME:|silhouette/.test(String(prompt || ''));

// Asset-plate tiling pitch (image node ≈ 220×280).
const PLATE_COL_W = 260;
const PLATE_ROW_H = 320;
// ShotGrid: a per-card container that accumulates take videos (5 columns; a cell ≈ a
// 16:9 video node + its header). New takes append; the grid grows by rows. TAKE_CELL_H is
// the row PITCH: a video AssetNode is ~184px tall while loading and ~190px once a 16:9
// clip fills it (4 tint + 32 header + 120/124 body + 28 caption); the pitch carries an
// extra gutter so rows never touch and the last row clears the grid's bottom edge.
const TAKE_COLS = 5;
const TAKE_CELL_H = 212;
// Take Viewer extraction panel: one titled GROUP per source take collects everything
// pulled from it (frames, notes, audio) — same grouped-outputs UX as the other agents.
const EXTRACT_COLS = 3;
const EXTRACT_COL_W = 300; // widest child (note/audio 280) + gutter
const EXTRACT_ROW_H = 350; // image node ≈ 320 tall; notes/audio sit shorter

// A note node object (not yet placed) — shared by the context-menu add and the
// viewer's Describe (which parents it into the extraction panel).
const buildNoteNode = ({ text = '', label = 'Note', meta = {} } = {}) => ({
  id: `note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  type: 'note',
  position: { x: 0, y: 0 },
  data: { text, label, meta },
});
// Storyboard panel grid: one ROW per shot, the shot's frames left-to-right (a cell each).

// A top-level node's bounding box for collision-aware placement. React Flow's
// measured dims when it has them; type-based fallbacks for nodes added this tick
// (not yet measured). Children (parentId) live inside groups — callers exclude them.
const NODE_FALLBACK = {
  cut: { w: 500, h: CUT_ROW_H },
  group: { w: 280, h: 220 },
  agent: { w: 250, h: 150 },
  note: { w: 280, h: 180 },
  story: { w: 1000, h: 420 }, // wide horizontal layout — beats laid left-to-right
  image: { w: 220, h: 280 },
  video: { w: 220, h: 240 },
  audio: { w: 220, h: 120 },
  text: { w: 280, h: 200 },
};
const nodeRect = (n) => {
  const key = n.type === 'cut' || n.type === 'group' || n.type === 'agent' ? n.type : (n.data?.kind || 'image');
  const fb = NODE_FALLBACK[key] || NODE_FALLBACK.image;
  const w = n.measured?.width || n.width || Number(n.style?.width) || fb.w;
  const h = n.measured?.height || n.height || Number(n.style?.height) || fb.h;
  return { x: n.position?.x || 0, y: n.position?.y || 0, w, h };
};

// Map a blueprint session's steps back to their CUT cards. Every shot emits exactly
// one animate step (direct cards have no keyframe step), so animates pair with cards
// positionally; keyframes only when every card has one (else the indices lie).
const mapCutSteps = (planSteps, cards) => {
  const m = new Map();
  const kfs = (planSteps || []).filter((s) => s.agent === 'inspiration');
  const anims = (planSteps || []).filter((s) => s.agent === 'animate');
  cards.forEach((c, i) => {
    if (kfs.length === cards.length && kfs[i]) m.set(kfs[i].id, { cardId: c.id, kind: 'kf' });
    if (anims[i]) m.set(anims[i].id, { cardId: c.id, kind: 'anim' });
  });
  return m;
};

// An AssetNode image renders at the card's full width with its natural aspect
// ratio, so the card's HEIGHT depends on the output ratio. Compute the grid row
// pitch from it so portrait (9:16) cards don't overflow/overlap and landscape
// (16:9) cards don't leave huge gaps. CARD_W = the AssetNode image width; the
// chrome constant is tuned so a 1:1 output reproduces the original CELL_H.
const CARD_W = 220;
const CARD_CHROME = CELL_H - CARD_W; // header + label + row gap (70px)
const cellHeightForRatio = (ratio) => {
  const m = /^(\d+):(\d+)$/.exec(ratio || '');
  if (!m) return CELL_H;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return CELL_H;
  return Math.round(CARD_W * (h / w) + CARD_CHROME);
};

const VIS_CYCLE = { show: 'dim', dim: 'hide', hide: 'show' };

// The image reference to send to an API for a node. Prefer the local bytes
// (localUrl, a data: URL) — for uploaded files the staged TOS URL is not publicly
// fetchable, so Seedream/Seed/Seedance would 403 trying to download it. base64
// passes straight through. Generated assets have no localUrl → use their URL.
// DURABLE-FIRST reference: the store url never expires (post-P0 every server path
// reads store urls natively); localUrl/raw url only when a node was never checked in.
const refUrl = (n) => n?.data?.cacheUrl || n?.data?.localUrl || n?.data?.url;

// Shrink a fat base64 reference so several bible refs don't blow the
// /api/film/imagine 20mb body limit (the suspected "empty shots" cause: uploaded
// bible anchors are multi-MB base64). http(s) URLs pass through untouched — the
// server inlines those itself — so only big data: URLs are downscaled (~1024px JPEG).
const REF_DOWNSCALE_OVER = 700 * 1024; // ~0.7MB of base64 ≈ a >0.5MB source image
const downscaleRef = async (url) => {
  if (typeof url !== 'string' || !url.startsWith('data:') || url.length < REF_DOWNSCALE_OVER) return url;
  try { return await makeThumbnail(url, 1024); } catch { return url; }
};

// Resolve a storyboard shot's references for the Seedream request: its `figures` → the pool refs (in
// order), and renumber the body's GLOBAL [Image N] → attach-order [Image N] (`@@N@@` sentinel avoids
// clobbering real numbers). Shots with no figures (Breakdown) fall back to a single pool ref. Shared
// by saveKeyframeShot (the card's Render still / the Expand editor's regenerate).
const resolveShotRefs = (s, refs = []) => {
  const figs = Array.isArray(s.figures) ? s.figures : [];
  const ordered = figs.length ? figs.map((g) => refs[g - 1]).filter(Boolean) : refs.slice(0, 1);
  let body = String(s.body || '');
  if (figs.length) { figs.forEach((g, i) => { body = body.split(`[Image ${g}]`).join(`@@${i + 1}@@`); }); body = body.replace(/@@(\d+)@@/g, '[Image $1]'); }
  return { ordered, body };
};

// A storyboard's reference POOL entry: {entryId?, nodeId?, url, label} — the pool ORDER
// is the [Image N] numbering the division and keyframes use. Older projects stored bare
// url strings; normalize wherever the pool is read.
const poolRef = (r) => (typeof r === 'string' ? { url: r, label: '' } : (r || {}));
const poolUrls = (refs) => (refs || []).map((r) => poolRef(r).url).filter(Boolean);

const buildInitialLayerState = (project) => {
  const settings = {};
  const visibility = {};
  AGENTS.forEach((layer) => {
    const saved = project.layers?.[layer.id] || {};
    settings[layer.id] = { ...layer.defaultSettings, ...(saved.settings || {}) };
    visibility[layer.id] = saved.visibility || 'show';
  });
  return { settings, visibility };
};

// Stamp each node's data.visibility from the per-layer visibility map.
const applyVisibility = (nodes, visibility) =>
  nodes.map((n) => {
    const lid = n.data?.layerId;
    const vis = lid ? (visibility[lid] || 'show') : 'show';
    if (n.data?.visibility === vis) return n;
    return { ...n, data: { ...n.data, visibility: vis } };
  });

// Run a Seedance shot, tolerating the input-image content SCREEN. Seedance rejects any
// reference image it flags as "may contain sensitive information / a real person" — and
// photoreal cast plates trip it EVEN as fully-registered asset:// refs (this endpoint has no
// consented-identity bypass). It names the FIRST offender as `content[N].image_url`, so drop
// that ref and retry, looping until the take renders; also drops audio on the output-audio
// screen. content order is [motion, (first_frame?), …refs], so refIndex = N − 1 − firstFrame.
// Returns { taskId, droppedRefs } — the caller surfaces droppedRefs (consistency impact).
const animateWithRefFallback = async (shot, refAssetIds, ctx) => {
  const inputScreened = (m) => /may contain (sensitive|real person)/i.test(m) && !/audio/i.test(m);
  const refIndexOf = (m) => { const x = /content\[(\d+)\]\.image_url/i.exec(m); return x ? Number(x[1]) - 1 - (shot.firstFrameUrl ? 1 : 0) : -1; };
  const urls = [...(shot.refUrls || [])];
  const ids = [...(refAssetIds || [])];
  let genAudio = shot.generateAudio !== false;
  const audioUrls = [...(shot.audioRefUrls || [])]; // the card's clips → reference audio (each droppable if screened)
  const videoUrls = [...(shot.videoRefUrls || [])]; // the card's videos → reference video
  const videoIds = [...(shot.videoRefAssetIds || [])]; // Library asset ids (aligned) — the screened-clip upgrade path
  let droppedRefs = 0;
  const healedAssets = []; // stale asset:// ids re-registered mid-shoot — caller persists the fresh ids
  // Each video may burn TWO tries (asset:// upgrade attempt, then drop).
  const maxTries = urls.length + audioUrls.length + videoUrls.length * 2 + 3;
  // content order the engine builds: [text, first_frame?, …images, …audios, …videos] —
  // so a `content[N].audio_url/video_url` complaint maps back to one droppable item.
  const mediaIndexOf = (m, key, base, len) => {
    const x = new RegExp(`content\\[(\\d+)\\]\\.${key}`, 'i').exec(m);
    if (!x) return len ? len - 1 : -1; // unindexed complaint → drop the last of that class
    const i = Number(x[1]) - base;
    return i >= 0 && i < len ? i : (len ? len - 1 : -1);
  };
  for (let t = 0; t < maxTries; t += 1) {
    try {
      const out = await animateOp({ // eslint-disable-line no-await-in-loop
        motion: shot.motion, camera: 'auto', refUrls: urls, refAssetIds: ids,
        firstFrameUrl: shot.firstFrameUrl, audioRefUrls: audioUrls, videoRefUrls: videoUrls,
        duration: shot.durationSec, resolution: shot.resolution, ratio: shot.ratio,
        generateAudio: genAudio, seed: shot.seed, modelKey: shot.modelKey,
      }, ctx);
      return { taskId: out.taskId, droppedRefs, healedAssets };
    } catch (e) {
      const m = e?.message || '';
      if (/output audio may contain sensitive/i.test(m) && genAudio) { genAudio = false; continue; }
      // A persisted assetId can go STALE — Ark assets are NOT eternal (retention/GC:
      // "The specified asset … is not found", hit live after a cloud restore). The id
      // is a cache of a registration, not a fact: RE-REGISTER from the ref's durable
      // url on the spot, retry with the fresh id (raw-url fallback if that fails),
      // and report the healing so the caller persists the new id.
      if (/asset .* is not found|asset[^ ]* is not found/i.test(m)) {
        const i = refIndexOf(m);
        if (i >= 0 && i < ids.length && ids[i]) {
          const staleId = ids[i];
          let freshId = null;
          try { freshId = (await preserveAsset(urls[i], `re-registered ref ${i + 1}`)).assetId || null; } // eslint-disable-line no-await-in-loop
          catch { /* raw-url fallback below */ }
          ids[i] = freshId;
          healedAssets.push({ url: urls[i], staleId, assetId: freshId });
          continue;
        }
      }
      // The INPUT screen flagged an attached clip / video — retake without JUST that
      // item rather than lose the whole take.
      const mediaBase = 1 + (shot.firstFrameUrl ? 1 : 0) + urls.length;
      if (audioUrls.length && /audio_url|input audio/i.test(m)) {
        const i = mediaIndexOf(m, 'audio_url', mediaBase, audioUrls.length);
        if (i >= 0) { audioUrls.splice(i, 1); continue; }
      }
      if (videoUrls.length && /video_url|input video/i.test(m)) {
        const i = mediaIndexOf(m, 'video_url', mediaBase + audioUrls.length, videoUrls.length);
        if (i >= 0) {
          // A screened clip with a Library twin retries as the TRUSTED asset:// ref
          // first (the image-bypass pattern; unproven for video — a rejection of the
          // asset form just falls through to the drop on the next loop).
          if (videoIds[i] && !String(videoUrls[i]).startsWith('asset://')) {
            videoUrls[i] = `asset://${videoIds[i]}`;
            videoIds[i] = null;
            continue;
          }
          videoUrls.splice(i, 1); videoIds.splice(i, 1); continue;
        }
      }
      const i = inputScreened(m) ? refIndexOf(m) : -1;
      if (i >= 0 && i < urls.length) { urls.splice(i, 1); ids.splice(i, 1); droppedRefs += 1; continue; }
      throw e;
    }
  }
  throw new Error('The video model rejected every reference image as sensitive — try non-photoreal plates or fewer refs.');
};

// STRUCTURE LOCK for in-place frame edits (the Edit-shot editor's "use this frame as
// reference"): the CURRENT frame leads as [Image 1], the body's [Image N] refs shift to
// [N+1], and the render goes through the lean `storyboard.frameEdit` template ("EDIT
// [Image 1], change only: …") instead of the cinematic wrapper. One editor, one switch.
// An edit attaches ONLY the refs the text actually MENTIONS: the frame already carries
// everyone in the shot, and unmentioned plates tug the render (identity refresh /
// recomposition pressure) — the opposite of a lock. Mentioned refs re-pack to [Image 2..].
const lockBodyToFrame = (body, ordered, frameSrc) => {
  let text = String(body || '').replace(/\[Image (\d+)\]/g, (m, n) => `[Image ${Number(n) + 1}]`);
  const mentioned = [...new Set([...text.matchAll(/\[Image (\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 2).sort((a, b) => a - b);
  const keep = [];
  const remap = new Map();
  mentioned.forEach((n) => {
    const u = ordered[n - 2];
    if (!u) return;
    // A mention that resolves to the frame itself (plain images: pool [Image 1] IS the
    // image) maps back to [Image 1] instead of dangling after the shift.
    if (u === frameSrc) { remap.set(n, 1); return; }
    if (!keep.includes(u)) keep.push(u);
    remap.set(n, keep.indexOf(u) + 2);
  });
  text = text.replace(/\[Image (\d+)\]/g, (m, n) => (Number(n) === 1 ? m : `[Image ${remap.get(Number(n)) ?? Number(n)}]`));
  return { body: text, refs: [frameSrc, ...keep] };
};

const FilmCanvasInner = ({ project, apiKey, serverKeyed = false, onUpdateProject, demoNonce }) => {
  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);
  // Key-less deployments: a server-configured API key exists, so generation guards
  // pass without a client key and requests omit the key (routes fall back to env).
  // A ref so the ~20 guards inside callbacks need no dependency churn.
  const serverKeyedRef = useRef(serverKeyed);
  useEffect(() => { serverKeyedRef.current = serverKeyed; }, [serverKeyed]);

  const initialLayerState = useMemo(() => buildInitialLayerState(project), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layerSettings, setLayerSettings] = useState(initialLayerState.settings);
  const [layerVisibility, setLayerVisibility] = useState(initialLayerState.visibility);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    // Tagged nodes (data.bibleRole + locked) are the bible's source of truth; the
    // reconciler derives entries from them on every change.
    applyVisibility(project.canvas?.nodes || [], initialLayerState.visibility),
  );
  // Initial value filters legacy gold per-reference edges too — the mount path seeds
  // state directly and never runs the project-switch effect below.
  const [edges, setEdges, onEdgesChange] = useEdgesState(dedupeEdgeList((project.canvas?.edges || []).filter((e) => !String(e.id || '').startsWith('cutedge-'))));
  // ONE writer for runtime edge changes: edges added mid-session through the
  // controlled prop alone intermittently never render until a remount (xyflow v12
  // store-sync quirk — state and manifest carried them, the canvas didn't). The
  // instance API writes the internal store directly; state is updated alongside so
  // serialization and the controlled prop stay canonical. Instance rides a REF —
  // this helper must exist before every consumer regardless of declaration order.
  const rfInstanceRef2 = useRef(null);
  // The updater runs against BOTH the React state and the RF instance store — two
  // snapshots that can already differ by the other write. A concat-style updater then
  // lands twice → DUPLICATE edge ids → React Flow renders NOTHING (duplicate keys).
  // dedupeEdgeList makes every runtime writer idempotent by construction.
  const applyEdges = useCallback((updater) => {
    setEdges((es) => dedupeEdgeList(updater(es)));
    const inst = rfInstanceRef2.current;
    if (inst && typeof inst.setEdges === 'function') inst.setEdges((es) => dedupeEdgeList(updater(es)));
  }, [setEdges]);

  // Agent-node ids currently running — PER-CARD, so a long agent (e.g. Cast & World)
  // never blocks Running another card. Each card's Run button gates on its own id.
  const [agentRunning, setAgentRunning] = useState([]);
  // The DRAFT panel target: a rail/context-menu tap opens the LayerPanel for this
  // agent id — configure FIRST, add to the board SECOND. Nothing lands on a click.
  const [panelAgentId, setPanelAgentId] = useState(null);
  const panelAtRef = useRef(null); // flow-coords drop spot captured from a right-click
  // The Take Viewer: which board video is open in the scrub/extract modal, and which
  // of its actions is in flight ('frame'|'first'|'last'|'describe'|'audio'|null).
  const [viewerId, setViewerId] = useState(null);
  const [lightboxId, setLightboxId] = useState(null); // full-screen image viewer (dbl-click an image)
  const [viewerBusy, setViewerBusy] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } in wrapper-relative px
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false); // the decision-history inspector
  const [traceVersion, setTraceVersion] = useState(0);    // bumped (debounced) on trace change → live panel
  // Collapsed when there are no shots yet (clean scratch — the action bar still
  // shows, so the timeline stays "showcased"); expands once it has content.
  const [timelineCollapsed, setTimelineCollapsed] = useState(() => !(project.timeline?.events?.length));
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [autoFillBusy, setAutoFillBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  // (The old "What's your film about?" brief card is gone — the idea is captured by
  // the Concierge's first question; the empty board offers template cards instead.)

  const loadedIdRef = useRef(project.id);
  const originOverride = useRef(null); // flow-coords origin captured from a right-click
  const nodesRef = useRef(nodes);      // latest nodes for input resolution
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const projectRef = useRef(project);  // latest project for async sessions' live getters
  useEffect(() => { projectRef.current = project; }, [project]);

  // True while a CUT shoot (🎬 / Action) is running: those dock the take UNDER its card
  // (upsertShotNodeForCard), so the generic session→board reconcile must NOT also drop a
  // loose copy (that was the "two videos per shot" / un-attached-shot bug).
  const cutShootActiveRef = useRef(false);

  // ---- the spine: timeline + bible (single source of truth = the project) ----
  const timeline = useMemo(() => project.timeline || emptyTimeline(), [project.timeline]);
  const bible = useMemo(() => project.bible || emptyBible(), [project.bible]);
  const timelineEvents = useMemo(() => orderedEvents(timeline.events || []), [timeline.events]);
  // Which board take nodes are currently ON the timeline (drives the Take node's button).
  const onTimelineNodeIds = useMemo(() => new Set((timelineEvents || []).map((e) => e.shotNodeId).filter(Boolean)), [timelineEvents]);
  // The dock renders clip thumbs from POSTERS (no <video> anywhere but the Take
  // Viewer) — enrich each event with its board take's posterUrl at render time,
  // never into the stored timeline (the take node owns the poster).
  const timelinePosters = useMemo(() => {
    const m = new Map();
    nodes.forEach((n) => { if (n.data?.kind === 'video' && n.data?.posterUrl) m.set(n.id, n.data.posterUrl); });
    return m;
  }, [nodes]);
  const timelineEventsView = useMemo(
    () => timelineEvents.map((e) => (e.shotNodeId && timelinePosters.get(e.shotNodeId) ? { ...e, posterUrl: timelinePosters.get(e.shotNodeId) } : e)),
    [timelineEvents, timelinePosters],
  );
  const bibleEntries = useMemo(() => bible.entries || [], [bible.entries]);
  const bibleRef = useRef(bibleEntries);  // latest bible for the async session/transport
  useEffect(() => { bibleRef.current = bibleEntries; }, [bibleEntries]);

  // Run trace — agent introspection. Every prompt + action in an Ad run is recorded
  // here (the transport is wrapped below) so the whole pipeline can be dumped to .txt
  // and re-assessed. The role resolver tags each reference url with its bible role, so
  // cross-role leakage (e.g. Character fed into a Location shot) is obvious in the dump.
  const traceRef = useRef(createTrace());
  useEffect(() => {
    const trace = traceRef.current;
    trace.setRoleResolver((u) => (bibleRef.current.find((b) => b.url === u) || {}).role || null);
    // Live panel: coalesce a burst of log writes into ~8 re-renders/sec.
    let timer = null;
    const unsub = trace.subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; setTraceVersion((v) => v + 1); }, 120);
    });
    return () => { if (timer) clearTimeout(timer); unsub(); };
  }, []);
  const traceGroups = useMemo(() => traceRef.current.groups(), [traceVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearTrace = useCallback(() => { traceRef.current.clear(); setTraceVersion((v) => v + 1); }, []);

  // The board IS the brand kit: project.bible is DERIVED from role-tagged board nodes
  // (data.bibleRole + locked), keyed by nodeId. This REPLACES the old bible→board
  // reconciler (which went the other way) — nodes are now the source of truth. Gated
  // on the project-switch effect (below) having loaded this project's nodes, so a
  // freshly-switched project isn't reconciled against the previous project's nodes.
  const bibleSeededRef = useRef(project.id); // armed for the current project once its nodes are loaded (first mount loads them in useNodesState)
  useEffect(() => {
    if (bibleSeededRef.current !== project.id) return;
    const derived = nodes
      // Bible membership = the TAG alone. `locked` is a separate, user-controlled pin
      // (manual tagging sets it; auto-tagged Cast & World drafts arrive UNLOCKED so
      // auditioning plates stay freely deletable/re-rollable while still anchoring).
      .filter((n) => n.data?.bibleRole && n.data?.kind === 'image' && (n.data?.bibleRefUrl || n.data?.localUrl || n.data?.url))
      .map((n) => bibleEntry({
        id: `bible-${n.id}`,
        role: n.data.bibleRole,
        name: n.data.label || n.data.bibleRole,
        // Prefer the downscaled ref (set on tag) so the producer's capped bible refs
        // don't blow the imagine body limit; fall back to the node's raw reference.
        url: n.data.bibleRefUrl || refUrl(n),
        // Carry the portrait-library asset id set by preserveNode on tag → the shoot
        // sends it as image_asset_id (trusted), not the screened/downscaled url.
        assetId: n.data.assetId || null,
        nodeId: n.id,
        locked: true,
      }));
    // Cheap signature: a data: URL (a base64 frame/plate) can be MEGABYTES — collapse it to a
    // length + tail proxy so this comparison (run on EVERY node change, incl. each keystroke)
    // never builds a giant string. Remote urls are short, so keep them verbatim (catches re-signs).
    const urlTag = (u) => { const s = u || ''; return s.startsWith('data:') ? `d${s.length}.${s.slice(-24)}` : s; };
    const sig = (es) => es.map((e) => `${e.nodeId}:${e.role}:${urlTag(e.url)}:${e.assetId || ''}`).join('|');
    updateBible((cur) => (sig(cur.entries || []) === sig(derived) ? cur : { ...cur, entries: derived }));
  }, [nodes, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // (The client-side check-in effect is GONE: every byte-producing route checks its
  // output into the store SERVER-SIDE and returns a stable store url — nodes are born
  // durable. Cloud-save's rescue pass covers any legacy straggler at save time.)

  // Functional updaters that write back into the owned project (guarded to the
  // currently-loaded project so a late async callback never writes the wrong one).
  const updateTimeline = useCallback((updater) => {
    onUpdateProject((prev) => {
      if (!prev || prev.id !== loadedIdRef.current) return prev;
      const cur = prev.timeline || emptyTimeline();
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, timeline: next };
    });
  }, [onUpdateProject]);

  const updateBible = useCallback((updater) => {
    onUpdateProject((prev) => {
      if (!prev || prev.id !== loadedIdRef.current) return prev;
      const cur = prev.bible || emptyBible();
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, bible: next };
    });
  }, [onUpdateProject]);

  // Re-initialize everything when the project actually changes (switch / open).
  useEffect(() => {
    if (loadedIdRef.current === project.id) return;
    loadedIdRef.current = project.id;
    const ls = buildInitialLayerState(project);
    setLayerSettings(ls.settings);
    setLayerVisibility(ls.visibility);
    setNodes(applyVisibility(project.canvas?.nodes || [], ls.visibility));
    // Edges must hydrate WITH the nodes — this effect historically set only nodes, so
    // every project switch silently dropped all edges from view (the state stayed at
    // whatever the previous project had; the canvas never remounts on switch).
    // Legacy gold per-reference edges (cutedge-…) are DROPPED at hydration — refs
    // live as chips on the cards; board edges are sequence bonds only.
    // PLAIN setEdges here, deliberately: nodes and edges must flow to React Flow in
    // the SAME render. An imperative instance write at this point races the store —
    // the nodes are still in React state, so RF prunes every edge as orphaned.
    // (applyEdges stays the rule for RUNTIME adds, where the nodes are already in.)
    setEdges(dedupeEdgeList((project.canvas?.edges || []).filter((e) => !String(e.id || '').startsWith('cutedge-'))));
    bibleSeededRef.current = project.id;
    sessionRef.current = null;
    setFilmProgress(null);
    outNodesRef.current = new Map();
    traceRef.current.clear(); // the run log belongs to one project's session
    sessionStateRef.current = project.auto || null;
    // Silently rehydrate the cached production session so per-shot iteration
    // (regenerate-with-note) survives a reload — no panel, the timeline is the surface.
    if (project.auto && (project.auto.plan || project.auto.steps || []).length && (apiKey?.trim() || serverKeyedRef.current)) {
      buildSession([], project.auto);
    }
    // Every project opens quiet — agents are picked from the rail, not auto-armed.
    setPanelAgentId(null);
    setSelectedEventId(null);
    setTimelineCollapsed(!(project.timeline?.events?.length));
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push canvas + layer state up to the parent (which debounce-persists to disk).
  // FINGERPRINT-GUARDED: selection flips and other churn produce an IDENTICAL persisted
  // payload (serializeNodes drops `selected`/transient flags) — skip the parent update
  // entirely then, so no re-render cascade and no disk write for a no-op.
  const lastSaveFpRef = useRef('');
  useEffect(() => {
    const handle = setTimeout(() => {
      const ser = serializeNodes(nodes);
      const fp = JSON.stringify([ser, edges, layerSettings, layerVisibility]);
      if (fp === lastSaveFpRef.current) return;
      lastSaveFpRef.current = fp;
      onUpdateProject((prev) => {
        // Guard on the CURRENT prop id (not loadedIdRef): a ref assigned in another
        // effect can go stale across hot-reload remount orderings — which silently
        // no-ops every canvas sync and leaves project.canvas EMPTY (the bug that let
        // an empty manifest get saved over a full board). The prop can't drift.
        if (!prev || prev.id !== project.id) return prev;
        const layers = { ...(prev.layers || {}) };
        AGENTS.forEach((layer) => {
          layers[layer.id] = {
            ...(layers[layer.id] || {}),
            enabled: true,
            visibility: layerVisibility[layer.id] || 'show',
            settings: layerSettings[layer.id] || {},
          };
        });
        return {
          ...prev,
          canvas: { nodes: ser, edges, viewport: prev.canvas?.viewport || null },
          layers,
          auto: sessionStateRef.current, // cached session snapshot for reload (no UI)
        };
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [nodes, edges, layerSettings, layerVisibility, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- DEMO REPLAY — the board plays itself (the pre-sales auto-demo) -------------
  // Pure theatre: no generation, no LLM. buildDemoSteps orders the EXISTING nodes
  // (pipeline story → creation order, or a hand-authored project.demoOrder) and the
  // player reveals them step by step with the camera following. Hiding rides the React
  // Flow `hidden` flag, which serializeNodes never emits — a demo can't touch saves.
  const [demoOverlay, setDemoOverlay] = useState(null); // { caption, i, n }
  const demoTokenRef = useRef(0);

  const stopDemo = useCallback(() => {
    demoTokenRef.current += 1; // any in-flight runner bails at its next check
    setDemoOverlay(null);
    setNodes((ns) => ns.map((n) => (n.hidden ? { ...n, hidden: false } : n)));
  }, [setNodes]);

  const runDemo = useCallback(async () => {
    const all = nodesRef.current;
    const steps = buildDemoSteps(all, projectRef.current);
    if (!steps.length) { Message.info('Nothing to demo yet — load or make a film first.'); return; }
    const token = ++demoTokenRef.current;
    const live = () => demoTokenRef.current === token;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Revealing a child must reveal its ancestors (a take needs its ShotGrid frame,
    // a keyframe its storyboard panel) — walk the parent chain.
    const parentOf = new Map(all.map((n) => [n.id, n.parentId || null]));
    const revealed = new Set();
    const revealWithAncestors = (ids) => ids.forEach((id) => {
      let cur = id;
      while (cur && !revealed.has(cur)) { revealed.add(cur); cur = parentOf.get(cur) || null; }
    });
    setNodes((ns) => ns.map((n) => ({ ...n, hidden: true, selected: false })));
    await sleep(400);
    for (let i = 0; i < steps.length; i += 1) {
      if (!live()) return;
      const s = steps[i];
      revealWithAncestors(s.ids);
      setDemoOverlay({ caption: s.caption, i: i + 1, n: steps.length });
      setNodes((ns) => ns.map((n) => (revealed.has(n.id) && n.hidden ? { ...n, hidden: false } : n)));
      await sleep(140); // let the reveal paint AND measure before the camera moves
      if (!live()) return;
      const frame = (s.frameIds?.length ? s.frameIds : s.ids).filter((id) => revealed.has(id));
      try { rfInstance?.fitView({ nodes: frame.map((id) => ({ id })), duration: 600, padding: s.padding ?? 0.45, maxZoom: 1.05 }); } catch { /* noop */ }
      await sleep(s.dwellMs ?? 1200);
    }
    if (!live()) return;
    // Finale — EVERYTHING on screen (steps skip empty/utility nodes; nothing stays lost).
    setDemoOverlay({ caption: 'One canvas — the whole film, brief to final cut', i: steps.length, n: steps.length });
    setNodes((ns) => ns.map((n) => (n.hidden ? { ...n, hidden: false } : n)));
    await sleep(80);
    if (!live()) return;
    try { rfInstance?.fitView({ duration: 900, padding: 0.15 }); } catch { /* noop */ }
    await sleep(2800);
    if (live()) setDemoOverlay(null);
  }, [rfInstance, setNodes]);

  // The playground bumps demoNonce (header ▶ Demo / cloud-row ▶). A bump can land
  // BEFORE a freshly-picked project's nodes commit — wait for a non-empty board.
  const demoNonceRef = useRef(0);
  useEffect(() => {
    if (!demoNonce || demoNonce === demoNonceRef.current || !nodes.length) return;
    demoNonceRef.current = demoNonce;
    runDemo();
  }, [demoNonce, nodes, runDemo]);
  useEffect(() => () => { demoTokenRef.current += 1; }, []); // unmount kills the runner
  // Switching projects mid-demo: the fresh board arrives unhidden — just cancel + clear.
  useEffect(() => { demoTokenRef.current += 1; setDemoOverlay(null); }, [project.id]);

  // FRESHEN a reference pool at render time: entries store {nodeId, url} — prefer the
  // LIVE node's durable refUrl (a pool url captured at attach time can be an expired
  // Ark signature; the 403 'Reference image could not be loaded' class). Fallback = as stored.
  const freshPoolUrls = useCallback((refs) => (refs || []).map((r) => {
    const e = poolRef(r);
    const live = e.nodeId ? nodesRef.current.find((n) => n.id === e.nodeId) : null;
    const fresh = live ? refUrl(live) : null;
    // A data: resolution (an un-checked-in upload's original bytes) must not displace a
    // stored url — stored pool/bible urls are the DOWNSCALED thumbs that keep request
    // bodies under the imagine 20mb limit. Freshen only onto real (durable) urls.
    if (fresh && !fresh.startsWith('data:')) return fresh;
    return e.url || fresh;
  }).filter(Boolean), []);

  // AUTO-FOCUS NEW BOARD ELEMENTS — anything freshly created (a card, a panel and its
  // children, a duplicate, an extracts frame) gets one gentle camera glide so nothing
  // lands off-screen unseen. Batched (350ms — a panel + N children focus ONCE), skipped
  // when everything new is already in view, during demo playback, and on mass arrivals
  // (>12 at once = a load, not an authoring action). Project switches reset silently.
  const knownIdsRef = useRef(null);
  const focusTimerRef = useRef(null);
  const pendingFocusRef = useRef(new Set());
  useEffect(() => { knownIdsRef.current = null; pendingFocusRef.current.clear(); }, [project.id]);
  useEffect(() => () => clearTimeout(focusTimerRef.current), []);
  useEffect(() => {
    if (knownIdsRef.current === null) { knownIdsRef.current = new Set(nodes.map((n) => n.id)); return; }
    const known = knownIdsRef.current;
    const fresh = nodes.filter((n) => !known.has(n.id));
    nodes.forEach((n) => known.add(n.id));
    if (!fresh.length || demoOverlay || fresh.length > 12) return;
    fresh.forEach((n) => pendingFocusRef.current.add(n.id));
    clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      const ids = [...pendingFocusRef.current];
      pendingFocusRef.current.clear();
      if (!rfInstance || !ids.length) return;
      try {
        const vp = rfInstance.getViewport();
        const rect = wrapperRef.current ? wrapperRef.current.getBoundingClientRect() : { width: 1200, height: 700 };
        const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: rect.width / vp.zoom, h: rect.height / vp.zoom };
        const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
        // Takes and their grids are born HIDDEN (the Take Library is their surface) —
        // never chase an invisible node: the camera would land on empty board.
        const visIds = ids.filter((nid) => { const n = byId.get(nid); return n && !n.hidden; });
        if (!visIds.length) return;
        const absOf = (n) => { let x = n.position?.x || 0; let y = n.position?.y || 0; for (let c = byId.get(n.parentId); c; c = byId.get(c.parentId)) { x += c.position?.x || 0; y += c.position?.y || 0; } return { x, y }; };
        const allVisible = visIds.every((nid) => {
          const n = byId.get(nid);
          if (!n) return true;
          const pos = absOf(n);
          const w = n.measured?.width || n.width || 280;
          const h = n.measured?.height || n.height || 320;
          return pos.x >= view.x && pos.y >= view.y && pos.x + w <= view.x + view.w && pos.y + h <= view.y + view.h;
        });
        if (allVisible) return; // already on screen — don't yank the camera
        rfInstance.fitView({ nodes: visIds.map((nid) => ({ id: nid })), duration: 500, padding: 0.35, maxZoom: 1 });
      } catch { /* camera nicety — never break the board over it */ }
    }, 350);
  }, [nodes, rfInstance, demoOverlay]);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  // ---- TAKE LIBRARY (right drawer) — the dailies bin off the canvas -----------------
  // Takes never render as board nodes; this drawer is the one surface for renders.
  // Focus is selection-derived: a selected SHOT card filters the drawer to its takes.
  const [takeLibOpen, setTakeLibOpen] = useState(false);
  // ---- REFERENCE BROWSER (right drawer) — the ONE library-picking surface -----------
  // Sources: a SHOT card ({type:'cut',id}), the storyboard pool ({type:'sbpool',id}),
  // a panel field ({type:'panel',field}) or a generic single-pick request
  // ({type:'pick',title,items,onPick} — keyframe slots). Every surface shows only its
  // ENABLED refs inline and opens this drawer to browse/toggle the rest.
  const [refDrawer, setRefDrawer] = useState(null);
  const openRefDrawer = useCallback((req) => { setTakeLibOpen(false); setRefDrawer(req); }, []);
  const closeRefDrawer = useCallback(() => setRefDrawer(null), []);
  const focusedCutId = useMemo(() => (selectedNodes.find((n) => n.type === 'cut') || {}).id || null, [selectedNodes]);
  // Groups mirror the SHOT cards in cut order. A card's takes = its grid children plus
  // the docked Action take (deduped when both hold the same render).
  const takeGroups = useMemo(() => {
    const cards = nodes.filter((n) => n.type === 'cut').sort((a, b) => (a.data?.cut ?? 0) - (b.data?.cut ?? 0));
    return cards.map((c) => {
      const gridId = `grid-${c.id}`;
      const takes = nodes.filter((n) => n.parentId === gridId && n.data?.kind === 'video');
      const docked = nodes.find((n) => n.id === `shot-${c.id}` && n.data?.kind === 'video');
      if (docked && !takes.some((t) => t.data?.url && t.data.url === docked.data?.url)) takes.push(docked);
      return {
        cardId: c.id,
        cut: c.data?.cut ?? 0,
        beat: c.data?.beat || '',
        status: c.data?.status || '',
        takes: takes.map((t) => ({
          id: t.id,
          url: t.data?.url || '',
          cacheUrl: t.data?.cacheUrl || '',
          posterUrl: t.data?.posterUrl || '',
          posterScaled: !!t.data?.posterScaled,
          loading: !!t.data?.loading,
          error: t.data?.error || '',
          label: t.data?.label || 'Take',
        })),
      };
    });
  }, [nodes]);
  // Drawer delete: same cascade as keyboard delete (the take's timeline clip drops),
  // plus a now-empty take grid is cleaned up. The card keeps its shot status — deleting
  // a take never un-shoots the card (parity with board delete).
  const deleteTakeById = useCallback((takeId) => {
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => e.shotNodeId !== takeId) }));
    setNodes((ns) => {
      const t = ns.find((n) => n.id === takeId);
      if (!t) return ns;
      const rest = ns.filter((n) => n.id !== takeId);
      if (t.parentId && String(t.parentId).startsWith('grid-') && !rest.some((n) => n.parentId === t.parentId)) {
        return rest.filter((n) => n.id !== t.parentId);
      }
      return rest;
    });
  }, [setNodes, updateTimeline]);
  // Drawer CLEAR: delete every take in scope (one card's, or the whole library) —
  // one cascade for all: timeline clips drop, emptied take grids clean up, cards
  // keep their shot status (deleting takes never un-shoots).
  const clearTakes = useCallback((cardId) => {
    const ids = new Set();
    takeGroups.forEach((g) => { if (!cardId || g.cardId === cardId) g.takes.forEach((t) => ids.add(t.id)); });
    if (!ids.size) return;
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !ids.has(e.shotNodeId)) }));
    setNodes((ns) => {
      const rest = ns.filter((n) => !ids.has(n.id));
      const liveGridIds = new Set(rest.filter((n) => n.parentId && String(n.parentId).startsWith('grid-')).map((n) => n.parentId));
      return rest.filter((n) => !(String(n.id).startsWith('grid-') && !liveGridIds.has(n.id)));
    });
    Message.success(`${ids.size} take${ids.size > 1 ? 's' : ''} deleted.`);
  }, [takeGroups, setNodes, updateTimeline]);
  // The card's 🎞 chip: open the drawer focused on that card — with ZERO board side
  // effects (no selection change, no pan; the user's viewport is sacred). Explicit
  // focus wins until the user selects a different card on the canvas.
  const [takeLibFocusId, setTakeLibFocusId] = useState(null);
  useEffect(() => { if (focusedCutId) setTakeLibFocusId(null); }, [focusedCutId]);
  const openTakesForCard = useCallback((cardId) => {
    setTakeLibFocusId(cardId);
    setTakeLibOpen(true);
  }, []);

  // Exactly ONE selected agent card → the LayerPanel opens bound to it (the agent
  // configuration surface — the card itself stays a compact summary + Run).
  const selectedAgentNode = useMemo(() => {
    const sel = selectedNodes.filter((n) => n.type === 'agent');
    return sel.length === 1 ? sel[0] : null;
  }, [selectedNodes]);
  // Clicking an agent card while a draft panel is open → the card takes the panel.
  useEffect(() => { if (selectedAgentNode && panelAgentId) setPanelAgentId(null); }, [selectedAgentNode, panelAgentId]);
  // Board image assets, for the Storyboard agent's optional reference picker (thumbnails to tick).
  const imageAssets = useMemo(() => nodes
    .filter((n) => n.data?.kind === 'image' && refUrl(n) && !n.data?.loading)
    .map((n) => ({ id: n.id, url: refUrl(n), label: n.data?.label || 'Image' })), [nodes]);
  // Board audio clips, for the Audio agent's voice/sound reference picker (@Audio1..N).
  const audioAssets = useMemo(() => nodes
    .filter((n) => n.data?.kind === 'audio' && refUrl(n) && !n.data?.loading)
    .map((n) => ({ id: n.id, label: n.data?.label || 'Audio', duration: Number(n.data?.duration) || null })), [nodes]);

  // ---- drop / add assets ----
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  // Upload a local file's bytes to TOS in the background and swap the node's
  // data URL for a real http URL, so it works as a reference in every agent.
  const stageNode = useCallback(async (nodeId, dataUrl, name, kind) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: true } } : n)));
    try {
      const { url, cacheUrl, assetId } = await stageLocalAsset(dataUrl, name);
      setNodes((ns) => ns.map((n) => (n.id === nodeId
        // cacheUrl (the durable store url) is the REFERENCE from here on; localUrl keeps
        //   the original bytes only as the instant preview. tosUrl + assetId = Seedance path.
        ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || undefined, tosUrl: url, localUrl: dataUrl, assetId, staged: true, preserved: !!assetId, loading: false } }
        : n)));
      // Uploaded images join the cross-project Library. Store a small embedded
      // thumbnail so the Library grid can preview it (the TOS url would 403).
      if (kind === 'image') {
        const thumb = await makeThumbnail(dataUrl);
        addToLibrary({ url, thumb, assetId, name: name || 'Upload', kind: 'image' })
          .then((items) => setLibraryItems(items))
          .catch(() => { /* non-fatal */ });
      }
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: false } } : n)));
      Message.warning(`Couldn't upload ${name}: ${err.message}`);
    }
  }, [setNodes]);

  // Turn dropped/picked files into nodes, then stage local media to TOS.
  const ingestFiles = useCallback(async (files, basePos) => {
    const created = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const kind = fileToAssetKind(file);
      if (!kind) continue; // non-media (e.g. a text file) — not a board asset
      try {
        const dataUrl = await readFileAsDataUrl(file); // eslint-disable-line no-await-in-loop
        const node = createAssetNode({
          kind,
          url: dataUrl,
          label: file.name,
          position: { x: basePos.x + i * 40, y: basePos.y + i * 40 },
        });
        created.push({ node, dataUrl, kind, name: file.name });
      } catch {
        Message.error(`Could not read ${file.name}`);
      }
    }
    if (created.length) {
      setNodes((ns) => ns.concat(applyVisibility(created.map((c) => c.node), layerVisibility)));
      // Stage non-text local media so it's usable in generations.
      created.forEach(({ node, dataUrl, kind, name }) => {
        if (kind !== 'text') stageNode(node.id, dataUrl, name, kind);
      });
    }
  }, [setNodes, layerVisibility, stageNode]);

  const onDrop = useCallback(async (event) => {
    event.preventDefault();
    if (!rfInstance) return;

    // A library asset dragged onto the board → place a preserved node.
    const assetPayload = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
    if (assetPayload) {
      try {
        const asset = JSON.parse(assetPayload);
        const pos = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const node = createAssetNode({
          kind: asset.kind || 'image',
          url: asset.url,
          label: asset.name || 'Asset',
          position: pos,
          preserved: true,
        });
        node.data.assetId = asset.assetId || null;
        node.data.tosUrl = asset.url;
        // Uploads carry an embedded thumb (their TOS url isn't fetchable); use it
        // as the local preview/reference. Generated assets have a loadable url.
        if (asset.thumb) node.data.localUrl = asset.thumb;
        setNodes((ns) => ns.concat(node));
      } catch {
        Message.error('Could not add library asset');
      }
      return;
    }

    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    const base = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    ingestFiles(files, base);
  }, [rfInstance, setNodes, ingestFiles]);

  // "Add" button → native file picker.
  const onPickFiles = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const center = rfInstance
      ? rfInstance.screenToFlowPosition({
          x: (wrapperRef.current?.clientWidth || 800) / 2,
          y: (wrapperRef.current?.clientHeight || 600) / 2,
        })
      : { x: 200, y: 200 };
    ingestFiles(files, center);
    event.target.value = ''; // allow re-picking the same file
  }, [rfInstance, ingestFiles]);


  // ---- library ----
  const refreshLibrary = useCallback(async () => {
    setLibraryItems(await listLibrary());
  }, []);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  const addLibraryItemToBoard = useCallback((item) => {
    const center = rfInstance
      ? rfInstance.screenToFlowPosition({
          x: (wrapperRef.current?.clientWidth || 800) / 2,
          y: (wrapperRef.current?.clientHeight || 600) / 2,
        })
      : { x: 240, y: 200 };
    const node = createAssetNode({
      kind: item.kind || 'image',
      url: item.url,
      label: item.name || 'Asset',
      position: center,
      preserved: true,
    });
    node.data.assetId = item.assetId || null;
    node.data.tosUrl = item.url;
    if (item.thumb) node.data.localUrl = item.thumb;
    setNodes((ns) => ns.concat(node));
    Message.success('Added to board');
  }, [rfInstance, setNodes]);

  // Permanently delete a library asset (TOS object + Assets-API asset + entry).
  // Irreversible, so confirm first and warn if anything on this board uses it.
  const deleteLibraryItem = useCallback((item) => {
    const usedBy = nodes.filter((n) =>
      n.data?.url === item.url || n.data?.tosUrl === item.url || (item.assetId && n.data?.assetId === item.assetId));
    Modal.confirm({
      title: 'Delete asset permanently?',
      content: (
        <div style={{ fontSize: 13 }}>
          This permanently deletes <b>{item.name || 'this asset'}</b> from your TOS bucket and the Assets
          library. It can&apos;t be undone.
          {usedBy.length > 0 && (
            <div style={{ marginTop: 8, color: '#f53f3f' }}>
              ⚠ {usedBy.length} item{usedBy.length === 1 ? '' : 's'} on this board use it and will break. It may
              also be referenced in other projects.
            </div>
          )}
        </div>
      ),
      okText: 'Delete permanently',
      okButtonProps: { status: 'danger' },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const { items, report } = await deleteFromLibrary({ id: item.id, url: item.url, assetId: item.assetId });
          setLibraryItems(items);
          const warn = [report.tos, report.asset].filter((r) => r && /failed|no-key/.test(r));
          if (warn.length) Message.warning(`Removed from library; storage delete: ${warn.join('; ')}`);
          else Message.success('Asset deleted permanently');
        } catch (err) {
          Message.error(`Delete failed: ${err.message}`);
        }
      },
    });
  }, [nodes]);

  // Permanently delete the WHOLE library (every TOS object + Assets-API asset + the index).
  // Irreversible, so confirm with the count and warn that board references will break.
  const clearLibrary = useCallback(() => {
    if (!libraryItems.length) { Message.info('The library is already empty.'); return; }
    Modal.confirm({
      title: 'Clear the whole library?',
      content: (
        <div style={{ fontSize: 13 }}>
          This permanently deletes <b>all {libraryItems.length} checked-in asset{libraryItems.length === 1 ? '' : 's'}</b> from
          your TOS bucket and the Assets library. It can&apos;t be undone, and anything on a board that references them will break.
        </div>
      ),
      okText: 'Clear all',
      okButtonProps: { status: 'danger' },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const { items, report } = await clearLibraryStore();
          setLibraryItems(items);
          if (report.failed) Message.warning(`Library cleared — ${report.failed} asset${report.failed === 1 ? '' : 's'} had a storage-delete error.`);
          else Message.success(`Library cleared — ${report.cleared || 0} asset${report.cleared === 1 ? '' : 's'} deleted.`);
        } catch (err) {
          Message.error(`Clear failed: ${err.message}`);
        }
      },
    });
  }, [libraryItems]);

  // (Story Director eliminated — the Timeline is the spine; Auto-fill + per-event
  // regenerate replace its rigid beat-by-beat wizard.)

  const selectAndCenter = useCallback((id) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    if (rfInstance) {
      try { rfInstance.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1, padding: 0.5 }); } catch { /* noop */ }
    }
  }, [setNodes, rfInstance]);

  // ---- preserve (check-in) ----
  // Re-host a node's expiring URL into TOS and swap data.url to the stable URL,
  // so the thumbnail and every downstream reference stop relying on the 24h URL.
  // Preserved assets are also added to the cross-project Library.
  const preserveNode = useCallback(async (node) => {
    const kind = node?.data?.kind;
    // Images AND videos register (asset:// for video is live-probed at the Assets API);
    // audio has no proven asset type — its durability is the store, not the Library.
    if (!node || !['image', 'video'].includes(kind) || !(node.data?.cacheUrl || node.data?.url)) return node?.data?.url;
    if (node.data?.preserved) return node.data.url;
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, preserving: true } } : n)));
    try {
      // Prefer the durable store url — for a take the raw url is a dying Ark signature.
      const { url: stableUrl, assetId, objectKey } = await preserveAsset(node.data.cacheUrl || node.data.url, node.data.label);
      setNodes((ns) => ns.map((n) => (n.id === node.id
        ? { ...n, data: { ...n.data, tosUrl: stableUrl, assetId, objectKey, preserved: true, preserving: false, expired: false } }
        : n)));
      addToLibrary({ url: stableUrl, assetId, name: node.data.label || 'Asset', kind })
        .then((items) => setLibraryItems(items))
        .catch(() => { /* non-fatal */ });
      return stableUrl;
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, preserving: false } } : n)));
      throw err;
    }
  }, [setNodes]);

  // EXPLICIT "Add to Library": preserve this node on demand — registers the trusted
  // asset:// id AND catalogues it in the cross-project Library. Auto-tagged Cast &
  // World plates deliberately skip this at draft time (auditions shouldn't spend
  // registrations); this button is how a KEEPER graduates, one tap, when YOU decide.
  const preserveNodeById = useCallback(async (id) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !['image', 'video'].includes(node.data?.kind) || node.data?.preserved) return;
    try {
      await preserveNode(node);
      Message.success(`“${String(node.data?.label || 'Asset').slice(0, 32)}” checked in — registered as a trusted asset and added to the Library.`);
    } catch (e) {
      Message.error(`Add to Library failed: ${e.message}`);
    }
  }, [preserveNode]);

  // ---- bible = role-tagged board nodes (the board IS the brand kit) ------------
  // A fat base64 anchor gets a downscaled reference (data.bibleRefUrl) so the
  // producer's capped bible refs stay under the imagine body limit; computed off the
  // main thread and patched in when ready (the full-res image still drives display).
  const scheduleRefDownscale = useCallback((nodeId, sourceUrl) => {
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('data:') || sourceUrl.length < REF_DOWNSCALE_OVER) return;
    downscaleRef(sourceUrl)
      .then((small) => { if (small && small !== sourceUrl) setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, bibleRefUrl: small } } : n))); })
      .catch(() => { /* keep the full-res ref */ });
  }, [setNodes]);

  // Tag (or untag) a board node as a bible anchor. Tagging locks it (canonical) and
  // schedules a downscaled ref; reconcileBibleFromNodes turns tagged nodes into
  // project.bible. Untag (role = null) releases + unlocks it.
  const tagNode = useCallback((id, role) => {
    setNodes((ns) => ns.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, bibleRole: role || null } }
      : n)));
    if (!role) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    scheduleRefDownscale(id, refUrl(node));
    // A generated/expiring image elevated to canon → preserve so the anchor never
    // lapses mid-production (uploads keep their local bytes, so skip those).
    if (node.data?.kind === 'image' && node.data?.url && !node.data?.localUrl && !node.data?.preserved) {
      preserveNode(node).catch((e) => Message.warning(`Preserve failed: ${e.message}`));
    }
  }, [setNodes, scheduleRefDownscale, preserveNode]);

  // Rename any board asset (image / video / frame / audio) — just patch its label.
  // A bible-tagged node's bible-entry `name` re-derives from the label automatically
  // (the reconciler reads `n.data.label`), so the cast & world stay in sync.
  const renameNode = useCallback((id, label) => {
    const clean = String(label || '').slice(0, 80);
    setNodes((ns) => {
      const target = ns.find((n) => n.id === id);
      // A storyboard ROW's label IS its beat — write both surfaces (card + control
      // node's shot list) or surgery/promotes would revert the rename.
      if (target?.data?.keyframe && target.data.panelId) {
        const chatId = String(target.data.panelId).replace('sbpanel', 'sbchat');
        const idx = Number(target.data.index) || 0;
        return ns.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, label: clean, beat: clean } };
          if (n.id === chatId && Array.isArray(n.data?.shots)) return { ...n, data: { ...n.data, shots: n.data.shots.map((sh, i) => (i === idx ? { ...sh, beat: clean } : sh)) } };
          return n;
        });
      }
      return ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: clean } } : n));
    });
  }, [setNodes]);

  // "Build brand kit": classify the board's UNTAGGED image nodes into AD roles and
  // tag each (role + lock) → they flow into project.bible via the reconciler.
  const classifyBoardAssets = useCallback(async () => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return []; }
    const targets = nodesRef.current.filter((n) => n.data?.kind === 'image' && (n.data?.localUrl || n.data?.url)
      && !n.data?.bibleRole && !n.id.startsWith('shot-') && !n.id.startsWith('film-'));
    if (!targets.length) { Message.warning('No untagged board images to sort — drop a few brand assets on the board first.'); return []; }
    const images = targets.map(refUrl).filter(Boolean);
    traceRef.current.startRun({ note: 'Build brand kit' });
    const rec = traceRef.current.log({ kind: 'bible.classify', note: `${images.length} board image${images.length === 1 ? '' : 's'}`, status: 'running' });
    try {
      const { assets } = await classifyAssets({ apiKey: apiKey.trim(), client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())), images, idea: '', roles: BIBLE_ROLES, requiredRoles: ['character', 'location'] });
      rec.status = 'ok';
      rec.assignments = assets.map((c) => `${c.role || '?'}(${c.confidence != null ? c.confidence.toFixed(2) : '?'})`).join(', ');
      let tagged = 0;
      assets.forEach((c) => {
        const node = targets[c.index];
        if (!node || !c.role) return;
        tagNode(node.id, c.role);
        if (c.name) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label: c.name } } : n)));
        tagged += 1;
      });
      Message.success(tagged ? `Sorted ${tagged} asset${tagged === 1 ? '' : 's'} into your brand kit — fix any role on its badge.` : 'Nothing could be sorted — tag roles on the nodes directly.');
      return assets.filter((c) => c.role).map((c) => c.role);
    } catch (err) {
      rec.status = 'error'; rec.error = err.message;
      Message.error(err.message);
      return [];
    }
  }, [apiKey, tagNode, setNodes]);


  // Delete is keyboard-driven (deleteKeyCode) — ReactFlow removes the node AND its
  // children (xyflow v12 cascades parentId) and hands us the full set here, so the
  // Final Cut timeline drops any clip that referenced a deleted take/keyframe.
  // ---- SEQUENCE chain: continuity edges (cut → cut) ------------------------------
  // Drawing an edge between SHOT cards means ONE thing: the source's last frame
  // threads into the target's shoot. Linear chain discipline: connecting replaces the
  // source's old outgoing and the target's old incoming bond.
  const onConnect = useCallback((conn) => {
    const sN = nodesRef.current.find((n) => n.id === conn.source);
    const tN = nodesRef.current.find((n) => n.id === conn.target);
    if (!sN || !tN || sN.type !== 'cut' || tN.type !== 'cut' || sN.id === tN.id) return;
    applyEdges((es) => es
      .filter((e) => !(e.type === 'continuity' && (e.target === conn.target || e.source === conn.source)))
      .concat({ id: `cont-${conn.source}-${conn.target}`, source: conn.source, target: conn.target, type: 'continuity' }));
  }, [applyEdges]);

  const rowsDeletedRef = useRef(null); // filled after rewritePanelRows exists (declaration order)
  const beforeDeleteRef = useRef(null); // same declaration-order dance for the veto
  const onBeforeDelete = useCallback(async (payload) => (beforeDeleteRef.current ? beforeDeleteRef.current(payload) : true), []);
  const onNodesDeleted = useCallback((deleted) => {
    if (rowsDeletedRef.current) rowsDeletedRef.current(deleted);
    // Deleting the STRIP element is a dismissal, remembered on the control node —
    // nothing recreates the strip except a fresh Divide/Re-divide.
    (deleted || []).forEach((n) => {
      if (String(n.id).startsWith('sbpanel-') && !/-\d+$/.test(String(n.id))) {
        const cid = String(n.id).replace('sbpanel', 'sbchat');
        setNodes((ns) => ns.map((x) => (x.id === cid ? { ...x, data: { ...x.data, stripHidden: true } } : x)));
      }
    });
    const ids = new Set((deleted || []).map((n) => n.id));
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !ids.has(e.shotNodeId) && !ids.has(e.keyframeNodeId)) }));
    // Chain HEAL: deleting a chained card reconnects its neighbours. The healed bond is
    // born flagged — a downstream take consumed a handoff that no longer exists.
    applyEdges((es) => {
      const cont = es.filter((e) => e.type === 'continuity');
      const heals = [];
      (deleted || []).filter((n) => n.type === 'cut').forEach((n) => {
        const inc = cont.find((e) => e.target === n.id && !ids.has(e.source));
        const out = cont.find((e) => e.source === n.id && !ids.has(e.target));
        if (inc && out) heals.push({ id: `cont-${inc.source}-${out.target}`, source: inc.source, target: out.target, type: 'continuity' });
      });
      return heals.length ? es.concat(heals.filter((h) => !es.some((e) => e.id === h.id))) : es;
    });
  }, [updateTimeline, applyEdges, setNodes]);

  // ---- layers ----
  const cycleVisibility = useCallback((layerId) => {
    setLayerVisibility((prev) => {
      const next = { ...prev, [layerId]: VIS_CYCLE[prev[layerId] || 'show'] };
      setNodes((ns) => applyVisibility(ns, next));
      return next;
    });
  }, [setNodes]);

  // Run any agent programmatically and collect what it produced. Used by the
  // manual Run button AND the Auto Director executor. Resolves once the agent's
  // run() returns (sync outputs already on the board); `done` resolves later when
  // async (video) assets finish, so callers that need final URLs can await it.
  // Storyboard panels → CUT cards. The card-laying logic lives with the other cut
  // handlers further down; the ref bridges the ordering.
  const storyboardPanelRef = useRef(null);

  // Cast & World streams plates via onPlan/onEntry (not onAsset), so every trigger —
  // agent card, strip, chat — routes through the same castDraft path. The handler is
  // defined far below (it needs genre detection + plate laying); this ref bridges the
  // ordering for the earlier-declared callers.
  const castRunRef = useRef(null);
  // Same bridge for the Brief rail agent (createStoryNode lives far below).
  const storyRunRef = useRef(null);
  // …and the Storyboard (shot-division) agent — spawnStoryboardChat lives far below.
  const storyboardRunRef = useRef(null);

  // Snap a batch's origin to open board space so successive runs (and a batch vs.
  // whatever is already there) never pile onto the same spot — the overlap bug.
  // Reads live nodes, so it sees everything placed so far this session.
  const freeOrigin = useCallback(({ w, h, preferred }) => {
    const rects = nodesRef.current.filter((n) => !n.parentId).map(nodeRect);
    return findFreeOrigin({ rects, w, h, preferred });
  }, []);

  // ---- Text NOTES ------------------------------------------------------------------
  // A NOTE is a first-class board element for plain words — right-click → "Text note",
  // or the viewer's Describe lands the VLM's read of a frame in one. Never a Brief:
  // Briefs hold the USER's words verbatim; notes are scratch.
  const createNoteNode = useCallback(({ text = '', label = 'Note', at = null, meta = {} } = {}) => {
    const pref = at || (rfInstance ? rfInstance.screenToFlowPosition({ x: 300, y: 220 }) : { x: 200, y: 200 });
    const position = freeOrigin({ w: 280, h: 180, preferred: pref });
    const node = { ...buildNoteNode({ text, label, meta }), position };
    setNodes((ns) => ns.concat(node));
    return node.id;
  }, [rfInstance, freeOrigin, setNodes]);

  // Parent a freshly-built node into the take's EXTRACTION PANEL (created beside the
  // take on first use, id `extracts-<takeId>`), tiling children in a 3-wide grid and
  // growing the frame to fit — the grouped-outputs UX every other agent has. Children
  // stay draggable-out (the generic panel drag-out detaches them); deleting the panel
  // cascades its children like any group.
  const addToExtractPanel = useCallback((take, node) => {
    const panelId = `extracts-${take.id}`;
    const dims = (n) => ({
      width: GROUP_PAD * 2 + Math.min(Math.max(n, 1), EXTRACT_COLS) * EXTRACT_COL_W,
      height: GROUP_HEADER + GROUP_PAD * 2 + Math.max(1, Math.ceil(n / EXTRACT_COLS)) * EXTRACT_ROW_H,
    });
    setNodes((ns) => {
      let next = ns;
      if (!next.some((x) => x.id === panelId)) {
        const d = dims(1);
        // The take is a CHILD of its ShotGrid — its position is grid-relative. Walk the
        // parent chain to the ABSOLUTE spot, or the panel lands at the canvas origin
        // instead of beside the take (the "I don't see the Extracts panel" bug).
        const byId = new Map(ns.map((p) => [p.id, p]));
        let ax = take.position?.x || 0; let ay = take.position?.y || 0;
        for (let cur = byId.get(take.parentId); cur; cur = byId.get(cur.parentId)) { ax += cur.position?.x || 0; ay += cur.position?.y || 0; }
        const position = freeOrigin({ w: d.width, h: d.height, preferred: { x: ax + 280, y: ay } });
        const grid = createGroupNode({ label: `Extracts · ${String(take.data?.label || 'Take').slice(0, 28)}`, position, width: d.width, height: d.height });
        next = next.concat({ ...grid, id: panelId });
      }
      const count = next.filter((x) => x.parentId === panelId).length;
      const d = dims(count + 1);
      next = next.map((x) => (x.id === panelId ? { ...x, style: { ...x.style, width: d.width, height: d.height } } : x));
      const pos = { x: GROUP_PAD + (count % EXTRACT_COLS) * EXTRACT_COL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(count / EXTRACT_COLS) * EXTRACT_ROW_H };
      return next.concat({ ...node, parentId: panelId, position: pos });
    });
  }, [freeOrigin, setNodes]);
  // DUPLICATE any board media element: a FREE copy (no generation) lands beside the
  // original — same bytes (url/cacheUrl/assetId), fresh identity. Bindings are stripped:
  // panel/keyframe wiring (a copy is a plain asset, its edits must not write back into a
  // chat's shot list), bible tags (no silent double entries — retag the copy if wanted),
  // and ★ media-ref flags (no duplicate offer chips).
  const duplicateNode = useCallback((id) => {
    const src = nodesRef.current.find((n) => n.id === id);
    if (!src?.data) return;
    const byId = new Map(nodesRef.current.map((p) => [p.id, p]));
    let ax = src.position?.x || 0; let ay = src.position?.y || 0;
    for (let cur = byId.get(src.parentId); cur; cur = byId.get(cur.parentId)) { ax += cur.position?.x || 0; ay += cur.position?.y || 0; }
    const {
      keyframe, panelId, index, bodyRendered, shotRefs, staleStill, renderedFrameEdit,
      bibleRole, locked, bibleRefUrl, mediaRef, loading, error, preserving, taskId, cutId, ...copy
    } = src.data;
    const position = freeOrigin({ w: 280, h: 320, preferred: { x: ax + 280, y: ay } });
    const node = createAssetNode({ kind: copy.kind || 'image', url: copy.url || '', label: '', position, layerId: copy.layerId || null });
    setNodes((ns) => ns.concat({ ...node, data: { ...node.data, ...copy, label: `${String(copy.label || 'Asset').slice(0, 40)} copy` } }));
  }, [freeOrigin, setNodes]);

  const editNoteText = useCallback((id, text) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)));
  }, [setNodes]);
  const renameNote = useCallback((id, label) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
  }, [setNodes]);
  const noteCtx = useMemo(() => ({ onChangeText: editNoteText, onRename: renameNote }), [editNoteText, renameNote]);

  const runAgent = useCallback(async ({ agentId, settings = {}, selectionNodes = [], origin, groupLabel }) => {
    const layer = AGENT_MAP[agentId];
    if (!layer) throw new Error(`Unknown agent: ${agentId}`);

    // A card-laying rail agent (laysCards) anchors its SHOT-card grid below everything
    // else on the board; `replacesCards` also wipes existing cut cards. (No live agent
    // sets these today — generic hooks kept for a future card-laying rail agent.)
    let sbBase = null;
    if (layer.laysCards) {
      const others = nodesRef.current.filter((n) => n.type !== 'cut');
      // Anchor the new card grid below everything else — using each node's ACTUAL
      // bottom edge (not a flat +360 guess that overlapped tall nodes).
      const bottom = others.length ? Math.max(...others.map((n) => { const r = nodeRect(n); return r.y + r.h; })) : 40;
      const left = others.length ? Math.min(...others.map((n) => n.position.x)) : 80;
      sbBase = { x: left, y: bottom + 80 };
      if (layer.replacesCards) {
        setNodes((ns) => ns.filter((n) => n.type !== 'cut'));
        setEdges((es) => es.filter((e) => !String(e.id).startsWith('cutedge-')));
      }
    }
    const fallback = rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 160 }) : { x: 160, y: 160 };
    const cellH = cellHeightForRatio(settings.ratio);
    let baseOrigin = origin || originFromSelection(selectionNodes, fallback);
    // Snap to open space (unless the caller pinned an explicit origin, or this is
    // a storyboard run which anchors its own base below everything). Estimate the
    // block: a grouped run is one frame; an ungrouped run lays a ~4-wide grid.
    if (!origin && !layer.laysCards) {
      const estCount = Math.min(Math.max(Number(settings.count) || 6, 1), 12);
      const estCols = Math.min(estCount, 4);
      const estW = layer.grouped ? GROUP_PAD * 2 + estCols * CELL_W : estCols * 250;
      const estH = layer.grouped
        ? GROUP_HEADER + GROUP_PAD + Math.ceil(estCount / estCols) * cellH
        : Math.ceil(estCount / 4) * cellH;
      baseOrigin = freeOrigin({ w: estW, h: estH, preferred: baseOrigin });
    }

    // Batch agents drop their outputs into one titled group frame (a "panel").
    let groupId = null;
    let groupCols = 4;
    if (layer.grouped) {
      const count = Math.min(Math.max(Number(settings.count) || 6, 1), 12);
      groupCols = Math.min(count, 4);
      const rows = Math.ceil(count / groupCols);
      const width = GROUP_PAD * 2 + groupCols * CELL_W;
      const height = GROUP_HEADER + GROUP_PAD + rows * cellH;
      const promptLabel = (groupLabel || settings.prompt || settings.direction || '').toString().slice(0, 36);
      const group = createGroupNode({
        layerId: layer.id,
        label: promptLabel ? `${layer.label} · ${promptLabel}` : layer.label,
        position: baseOrigin,
        width,
        height,
      });
      groupId = group.id;
      setNodes((ns) => ns.concat(group));
    }

    let cursor = 0;
    const placeNext = () => {
      const i = cursor;
      cursor += 1;
      if (groupId) {
        // No extent:'parent' — children may be dragged OUT of the panel; crossing the
        // frame's edge detaches them to the open board (handleNodeDragStop).
        return {
          position: { x: GROUP_PAD + (i % groupCols) * CELL_W, y: GROUP_HEADER + Math.floor(i / groupCols) * cellH },
          parentId: groupId,
        };
      }
      return { position: { x: baseOrigin.x + (i % 4) * 250, y: baseOrigin.y + Math.floor(i / 4) * cellH } };
    };

    // MULTI-group support (a batch agent lays one titled frame per group).
    // An agent calls onGroup({ label }) per group and stamps its assets with the
    // returned groupId; assets without one flow through the classic placeNext path.
    const MG_COLS = 2;
    const MG_ROWS = 2; // ~4 images per concept — frames sized to what actually lands
    let mgIndex = 0;
    const mgGroups = new Map(); // groupId -> { idx }
    const onGroup = ({ label } = {}) => {
      const width = GROUP_PAD * 2 + MG_COLS * CELL_W;
      const height = GROUP_HEADER + GROUP_PAD + MG_ROWS * cellH;
      const group = createGroupNode({
        layerId: layer.id,
        label: `${(label || layer.label)}`.slice(0, 48),
        position: { x: baseOrigin.x + (mgIndex % 3) * (width + 40), y: baseOrigin.y + 80 + Math.floor(mgIndex / 3) * (height + 60) },
        width,
        height,
      });
      mgIndex += 1;
      setNodes((ns) => ns.concat(group));
      mgGroups.set(group.id, { idx: 0 });
      return group.id;
    };
    const placeInGroup = (gid) => {
      const g = mgGroups.get(gid);
      if (!g) return placeNext();
      const i = g.idx;
      g.idx += 1;
      return {
        position: { x: GROUP_PAD + (i % MG_COLS) * CELL_W, y: GROUP_HEADER + Math.floor(i / MG_COLS) * cellH },
        parentId: gid,
      };
    };

    const outputs = [];           // [{ id, url, kind, label }] — live, async urls filled on resolve
    const outById = {};
    const pending = [];           // promises for async (video) assets
    const settle = {};            // nodeId -> resolver
    let panelCount = 0;           // storyboard cards land via onPanel (not onAsset) — count them so the trace doesn't report "0 outputs"

    // Every rail/routed agent run is a WORKFLOW in the decision history: open one,
    // inject a trace-wrapped client (the agents fall back to their own otherwise),
    // and every model call it makes lands in the History panel like producer runs.
    traceRef.current.startRun({ note: `Agent · ${layer.label}` });
    const steer = (settings.prompt || settings.direction || settings.topic || settings.question || settings.motion || '').toString().replace(/\s+/g, ' ').trim();
    traceRef.current.log({
      level: 'run', kind: 'inputs',
      note: `${steer ? `input="${steer.slice(0, 160)}" · ` : ''}selection: ${selectionNodes.length} node(s)`,
    });
    const tracedCtx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };

    let result;
    try {
      result = await layer.run({
      prompt: settings.prompt,
      selection: selectionNodes,
      settings,
      apiKey,
      ctx: tracedCtx,
      onGroup,
      // A panel-streaming agent (if any) lays its SHOT cards as the panels arrive.
      onPlan: (panels) => { if (storyboardPanelRef.current) panels.forEach((p) => storyboardPanelRef.current(p, sbBase)); },
      onPanel: (panel) => { panelCount += 1; if (storyboardPanelRef.current) storyboardPanelRef.current(panel, sbBase); },
      onAsset: (spec) => {
        const { position, parentId, extent } = spec.groupId ? placeInGroup(spec.groupId) : placeNext();
        const node = createAssetNode({ ...spec, position });
        if (parentId) { node.parentId = parentId; node.extent = extent; }
        node.data.visibility = layerVisibility[spec.layerId] || 'show';
        const rec = { id: node.id, url: spec.url, kind: spec.kind || 'image', label: spec.label };
        outputs.push(rec); outById[node.id] = rec;
        setNodes((ns) => ns.concat(node));
        return node.id;
      },
      onPendingAsset: (spec) => {
        const { position, parentId, extent } = spec.groupId ? placeInGroup(spec.groupId) : placeNext();
        const node = createAssetNode({ ...spec, position });
        if (parentId) { node.parentId = parentId; node.extent = extent; }
        node.data.loading = true;
        node.data.visibility = layerVisibility[spec.layerId] || 'show';
        const rec = { id: node.id, url: undefined, kind: spec.kind || 'video', label: spec.label };
        outputs.push(rec); outById[node.id] = rec;
        setNodes((ns) => ns.concat(node));
        pending.push(new Promise((res) => { settle[node.id] = res; }));
        return node.id;
      },
      onResolveAsset: (id, patch) => {
        setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
        if (outById[id] && patch?.url) outById[id].url = patch.url;
        if (settle[id]) { settle[id]({ id, ok: true, url: patch?.url }); delete settle[id]; }
      },
      onFailAsset: (id, message) => {
        setNodes((ns) => ns.map((n) => (n.id === id
          ? { ...n, data: { ...n.data, loading: false, label: `${n.data?.kind === 'video' ? 'Animation' : 'Generation'} failed`, error: message } }
          : n)));
        if (settle[id]) { settle[id]({ id, ok: false, error: message }); delete settle[id]; }
      },
      onError: (errs) => { if (errs?.length) Message.warning(errs[0]); },
      });
    } catch (err) {
      // Pre-call failures (no selection, empty topic) never hit the wrapped client —
      // record them so the workflow doesn't sit empty in the history.
      traceRef.current.log({ level: 'run', kind: 'warning', note: `${layer.label} failed: ${err.message}` });
      throw err;
    }
    const placed = outputs.length + panelCount;
    traceRef.current.log({ level: 'run', kind: 'outputs', note: `${placed} ${panelCount ? 'card' : 'output'}${placed === 1 ? '' : 's'} on the board` });

    const done = pending.length ? Promise.all(pending) : Promise.resolve([]);
    return { groupId, outputIds: outputs.map((o) => o.id), outputs, result, done };
  }, [rfInstance, apiKey, layerVisibility, setNodes, setEdges, freeOrigin]);

  // (The clip-scoped agent runs — the side panel's "fill this clip" mode — left with
  // the panel. The timeline's own Auto-fill / per-event regenerate still cover clips.)

  // The storyboard NEVER blocks and NEVER generates under the hood: the hidden
  // no-reference fallback (generateAnchorRefs, an automatic Cast & World run) is GONE,
  // and so is the "no cast" confirm gate — an unanchored storyboard simply runs
  // reference-free (bible characters are still passively reused as refs when they
  // exist; see runDivide's reference fold-in).


  // The AUDIO agent: the typed prompt goes out VERBATIM (word for word, original
  // language) and comes back as a playable clip node — one explicit tap, one call,
  // mixed into nothing. Seed Audio 1.0 (default) follows the prompt — voice id
  // optional; references = up to 3 ticked board clips (@Audio1..N — a voice or
  // sound to imitate) OR one board image for scene mood; Seed TTS 2.0 reads
  // word-for-word and needs the voice id. The clip lands loading-first (instant
  // feedback), fills in when the voice API returns, and the media store checks
  // its data: url into a real file seconds later.
  const runAudioClip = useCallback(async ({ text, voice = '', instruction = '', model = 'seedAudio', imageRef = '', audioRefs = [], near = null } = {}) => {
    const line = String(text || '').trim() ? String(text) : '';
    if (!line) { Message.warning(model === 'seedAudio' ? 'Type the audio prompt first — it goes to the model word for word.' : 'Type the line to speak first — it is spoken word for word.'); return; }
    // Seed Audio casts voices FROM THE PROMPT — no voice id in that mode (a stale panel
    // value must not sneak in as a `speaker` reference and collide with the mood image).
    if (model === 'seedAudio') voice = '';
    else if (!String(voice || '').trim()) { Message.warning('Seed TTS 2.0 needs a voice id — set it in the panel (or switch to Seed Audio 1.0).'); return; }
    // References ride as URLS (data:/store/remote) — the ROUTE resolves the bytes
    // server-side, the only layer that can always read them (the browser can't fetch
    // cross-origin signed urls; the voice host can't fetch anything of ours). Only
    // an oversized dropped data: image is shrunk here, where a canvas exists.
    let imageData;
    if (model === 'seedAudio' && imageRef) {
      const refNode = nodesRef.current.find((x) => x.id === imageRef);
      const u = refNode && refUrl(refNode);
      if (u) imageData = String(u).startsWith('data:') ? await downscaleRef(u) : absLocalMediaUrl(u);
      else Message.warning('The picked reference image is gone from the board — generating without it.');
    }
    // Voice/sound references: board clips in pick order — @Audio1..N in the prompt.
    const audioRefData = [];
    if (model === 'seedAudio') {
      for (const rid of (audioRefs || []).slice(0, 3)) {
        const clip = nodesRef.current.find((x) => x.id === rid);
        const u = clip && refUrl(clip);
        if (!u) { Message.warning('A picked reference clip is gone from the board — skipping it.'); continue; }
        if (Number(clip.data?.duration) > 30) Message.warning(`"${clip.data?.label || 'clip'}" runs ${Math.round(clip.data.duration)}s — Seed Audio reference clips cap at 30s, it may be rejected.`);
        audioRefData.push(absLocalMediaUrl(u));
      }
      if (audioRefData.length && imageData) {
        Message.warning('Audio references and a mood image cannot mix — using the audio references.');
        imageData = undefined;
      }
    }
    const pref = near || (rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 260 }) : { x: 220, y: 240 });
    const position = freeOrigin({ w: 280, h: 150, preferred: pref });
    const node = createAssetNode({ kind: 'audio', url: '', label: line.trim().slice(0, 40), position, layerId: 'audio' });
    node.data.loading = true;
    node.data.audioText = line;
    if (voice) node.data.voice = voice;
    setNodes((ns) => ns.concat(node));
    traceRef.current.startRun({ note: `Agent · Audio (${model === 'seedAudio' ? 'Seed Audio 1.0' : 'Seed TTS 2.0'})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, duration } = await generateFilmAudio({ text: line, voice, model, instruction, imageData, audioRefs: audioRefData }, ctx);
      // duration persists on the clip — the SHOT-card attach path shows it and warns
      // when it exceeds Seedance's 15s reference-audio cap.
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, url, duration: Number(duration) || null, loading: false } } : n)));
      Message.success('Audio clip on the board — press play.');
    } catch (e) {
      Message.error(`Audio failed: ${e.message}`);
      setNodes((ns) => ns.filter((n) => n.id !== node.id));
    }
  }, [apiKey, rfInstance, freeOrigin, setNodes]);


  // ---- Previz v2: FLOOR PLAN — the scene's schematic overhead blocking map ------------
  // One explicit tap = ONE reason call (the AD planner CoT: space → parties → moves →
  // AXIS) + ONE Seedream Pro render (literal mode). The map lands as a normal image
  // node (layerId 'previz'): editable like any image; attaching it to a SHOT card is
  // the projection moment (see attachMapToCard).
  const runFloorPlan = useCallback(async ({ brief, near = null } = {}) => {
    const text = String(brief || '').trim();
    if (!text) { Message.warning('Give Previz the scene text — type it in the panel or select a Brief card.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const pref = near || (rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 240 }) : { x: 220, y: 220 });
    const position = freeOrigin({ w: 360, h: 380, preferred: pref });
    const node = createAssetNode({ kind: 'image', url: '', label: 'Schematic', position, layerId: 'previz' });
    node.data.loading = true;
    node.data.floorPlan = true;
    node.data.floorPlanBrief = text;
    setNodes((ns) => ns.concat(node));
    traceRef.current.startRun({ note: 'Agent · Previz · schematic' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, cacheUrl, planPrompt } = await floorPlan({ brief: text }, ctx);
      traceRef.current.log({ level: 'run', kind: 'decision', note: 'Previz · schematic rendered' });
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || n.data.cacheUrl, planPrompt, loading: false } } : n)));
      Message.success('Schematic on the board — edit it like any image, then attach it to a SHOT card to project the blocking.');
    } catch (e) {
      Message.error(`Schematic failed: ${e.message}`);
      setNodes((ns) => ns.filter((n) => n.id !== node.id));
    }
  }, [apiKey, rfInstance, freeOrigin, setNodes]);

  // MASK — reproduce ANY board image (storyboard frames, uploads, plates) with every
  // person as a flat color silhouette: identities are scrubbed, the plate is pure
  // geometry. Landed plates carry the attach / cast-colors toolkit.
  const maskFlightRef = useRef(new Set());
  const maskPrevisNode = useCallback(async (id, instruction = '') => {
    if (maskFlightRef.current.has(id)) return;
    const src = nodesRef.current.find((n) => n.id === id);
    const srcUrl = absLocalMediaUrl(src?.data?.url || src?.data?.cacheUrl || '');
    if (!srcUrl) { Message.warning('The image is still rendering — mask it once it lands.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    maskFlightRef.current.add(id);
    const position = freeOrigin({ w: 360, h: 260, preferred: { x: (src.position?.x || 0) + 400, y: src.position?.y || 0 } });
    const node = createAssetNode({ kind: 'image', url: '', label: 'Blocking plate', position, layerId: 'storyboard' });
    node.data.loading = true;
    node.data.previzMask = true;
    node.data.maskSource = id;
    if (src.data?.sourceCutId) node.data.sourceCutId = src.data.sourceCutId;
    setNodes((ns) => ns.concat(node));
    traceRef.current.startRun({ note: 'Mask · blocking plate' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, cacheUrl } = await maskFrame({ url: srcUrl, instruction }, ctx);
      traceRef.current.log({ level: 'run', kind: 'decision', note: 'Mask · blocking plate rendered' });
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || n.data.cacheUrl, loading: false } } : n)));
      Message.success('Blocking plate ready — use its "Attach to SHOT card" button; the color-binding line lands in the card\'s prompt.');
    } catch (e) {
      Message.error(`Mask failed: ${e.message}`);
      setNodes((ns) => ns.filter((n) => n.id !== node.id));
    } finally { maskFlightRef.current.delete(id); }
  }, [apiKey, freeOrigin, setNodes]);

  // MASK any board image — the button opens a small modal: leave it empty for the
  // classic every-person scrub, or say EXACTLY what to mask (rides VERBATIM into the
  // template's targets slot). The plate lands beside the source as before.
  const [maskImgId, setMaskImgId] = useState(null);
  const [maskImgPrompt, setMaskImgPrompt] = useState('');
  const runMaskImage = useCallback(() => {
    const id = maskImgId;
    const want = String(maskImgPrompt || '').trim();
    setMaskImgId(null); setMaskImgPrompt('');
    if (id) maskPrevisNode(id, want);
  }, [maskImgId, maskImgPrompt, maskPrevisNode]);

  // Empty-board front door: the intake textarea's draft + a "blank board" dismissal.
  const [introBrief, setIntroBrief] = useState('');
  const [introDismissed, setIntroDismissed] = useState(false);

  // "Cast the colors" on a blocking plate: which plate's colorCast is being edited.
  const [plateCastId, setPlateCastId] = useState(null);
  const savePlateCast = useCallback((map) => {
    const id = plateCastId;
    if (!id) return;
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, colorCast: map || {} } } : n)));
    setPlateCastId(null);
    const count = Object.keys(map || {}).length;
    Message.success(count
      ? `Colors cast (${count}) — attaching this plate now auto-attaches those characters and writes the named FIRST FRAME lock.`
      : 'Color assignments cleared — attaching falls back to the generic lock.');
  }, [plateCastId, setNodes]);

  // UNIVERSAL frame editing — Edit on ANY non-storyboard image opens the SAME shot
  // editor (storyboard frames reach it via their own Edit): the image itself seeds a
  // LOCAL reference pool as [Image 1], more board images can join, Re-derive writes a
  // body FROM the ticked refs, and Regenerate renders a NEW frame BESIDE the source —
  // never overwriting (uploads and plates stay; edits chain). The editor's state
  // persists on the node (editBody/editTemplate/editExpression/editFigures/editPool).
  const [plainPool, setPlainPool] = useState([]);
  const openFrameEditor = useCallback((id) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n) return;
    if (!n.data?.keyframe) {
      const u = refUrl(n) || '';
      const saved = Array.isArray(n.data?.editPool) && n.data.editPool.length ? n.data.editPool : null;
      // Saved pools keep their added refs, but the FRAME entry always re-resolves from
      // the live node — a stale editPool[0] was the frame-edit 403 class.
      setPlainPool(saved ? [u || saved[0], ...saved.slice(1)] : (u ? [u] : []));
    }
    setExpandedKeyframeId(id);
  }, []);
  const regeneratePlainFrame = useCallback(async (id, edits = {}) => {
    const src = nodesRef.current.find((n) => n.id === id);
    if (!src) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const shot = { beat: src.data?.label || 'frame', shotTemplate: edits.shotTemplate || 'medium-shot', expression: edits.expression || '', figures: Array.isArray(edits.figures) ? edits.figures : [], body: String(edits.body || '').trim() };
    if (!shot.body) { Message.warning('Write the body first — or Re-derive it from the ticked references.'); return; }
    let { ordered, body } = resolveShotRefs(shot, plainPool);
    // Structure lock (same switch as storyboard cards): the source frame leads as [Image 1].
    const frameSrc = (edits.annotatedFrame || refUrl(src) || src.data?.cacheUrl) || '';
    const frameEdit = !!(edits.useFrame && frameSrc);
    if (frameEdit) ({ body, refs: ordered } = lockBodyToFrame(body, ordered, frameSrc));
    // Camera change under the lock = a named change: reframe the same scene.
    if (frameEdit && shot.shotTemplate && shot.shotTemplate !== (src.data?.editTemplate || 'medium-shot')) {
      const tpl = SHOT_TEMPLATE_BY_ID[shot.shotTemplate];
      if (tpl) body = `Reframe to a ${tpl.framing}, ${tpl.angle} — the same scene, subjects and moment. ${body}`;
    }
    // The card IS the frame being iterated — the render replaces its image in place,
    // exactly like a keyframe card. Duplicate first to keep
    // both versions (the previous image's bytes stay safe in the store/Library either way).
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, editBody: shot.body, editTemplate: shot.shotTemplate, editExpression: shot.expression, editFigures: shot.figures, editPool: plainPool, loading: true, error: undefined } } : n)));
    setExpandedKeyframeId(null);
    traceRef.current.startRun({ note: 'Agent · Frame edit (shot editor)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, cacheUrl } = await storyboardKeyframe({ body, shotTemplate: shot.shotTemplate, style: '', expression: shot.expression, refs: ordered, imageModel: defaultImageModelKey(), frameEdit, frameEditAnnotated: !!edits.annotatedFrame }, ctx);
      // The image CHANGED: stale display/registration state must not survive — the old
      // cacheUrl/localUrl would keep SHOWING the old frame, and the old assetId would
      // keep REFERENCING it in shoots (re-register on demand via the usual paths).
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || undefined, localUrl: undefined, assetId: null, preserved: false, loading: false, error: undefined } } : n)));
      Message.success('Frame updated in place — Duplicate first when you want to keep both versions.');
    } catch (e) {
      Message.error(`Frame edit failed: ${e.message} — the card kept its current image.`);
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, loading: false } } : n)));
    }
  }, [apiKey, plainPool, setNodes]);
  const rederivePlainBody = useCallback(async (id, figures) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return null; }
    const src = nodesRef.current.find((n) => n.id === id);
    traceRef.current.startRun({ note: 'Agent · Frame edit (re-derive body)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    return await storyboardShotBody({ script: '', beat: src?.data?.label || 'this frame', figures, style: '', references: plainPool }, ctx);
  }, [apiKey, plainPool]);

  // (handleRun — the side panel's Run dispatcher — is gone: every agent is a board
  // element now. Cards run themselves via runAgentNode; the rail is a palette.)

  // ---- the production engine (drives the timeline; no panel) ------------------
  // The orchestration loop lives in the shared core session (createProduction). The
  // canvas DRIVES it via Auto-fill / per-event regenerate and renders its state onto
  // the timeline spine — there is no Auto Director panel or plan node anymore.
  const sessionRef = useRef(null);
  const outNodesRef = useRef(new Map());       // stepId -> last rendered url (board dedupe)
  const sessionStateRef = useRef(project.auto || null); // last snapshot, persisted for reload

  // Project the session's picked step outputs onto the board (keyframes + shots +
  // the final film), keyed by step id so it's idempotent across regenerate/reload.
  const reconcileSessionNodes = useCallback((state) => {
    // A cut shoot docks the take under its own card — don't also drop a loose grid copy.
    if (cutShootActiveRef.current) return;
    const seen = outNodesRef.current;
    const baseX = 80;
    const baseY = 280; // below the bible row up top
    const upserts = [];
    (state.plan || []).forEach((step, i) => {
      const keeper = (step.outputs || []).find((o) => o.id === step.pickedId) || (step.outputs || [])[0];
      if (!keeper || !keeper.url || seen.get(step.id) === keeper.url) return;
      seen.set(step.id, keeper.url);
      upserts.push({ id: `shot-${step.id}`, kind: keeper.kind, url: keeper.url, label: step.title || step.agent, pos: { x: baseX + (i % 4) * 260, y: baseY + Math.floor(i / 4) * 300 } });
    });
    const filmUrl = state.film?.url || state.film?.path;
    if (filmUrl && seen.get('__film') !== filmUrl) {
      seen.set('__film', filmUrl);
      upserts.push({ id: 'film-final-cut', kind: 'video', url: filmUrl, label: 'Film — final cut', preserved: true, pos: { x: baseX, y: baseY + Math.ceil((state.plan?.length || 0) / 4) * 300 + 40 } });
    }
    if (!upserts.length) return;
    setNodes((ns) => {
      const byId = new Map(ns.map((n) => [n.id, n]));
      upserts.forEach((u) => {
        const existing = byId.get(u.id);
        if (existing) byId.set(u.id, { ...existing, data: { ...existing.data, kind: u.kind, url: u.url, label: u.label } });
        else byId.set(u.id, createAssetNode({ id: u.id, kind: u.kind, url: u.url, label: u.label, position: u.pos, preserved: !!u.preserved }));
      });
      return Array.from(byId.values());
    });
  }, [setNodes]);

  // Single event sink: cache the snapshot (for reload), project outputs onto the
  // board, and mirror the session's animate steps onto the timeline spine.
  const handleSessionEvent = useCallback((e) => {
    // Fold every decision (plan, phase, per-step status, QC, final cut) into the
    // run trace so the History panel shows the producer's reasoning, not just calls.
    traceRef.current.ingestSessionEvent(e);
    if (e.type === 'state') {
      sessionStateRef.current = e.state;
      reconcileSessionNodes(e.state);
      updateTimeline((cur) => ({ ...cur, events: mirrorSessionEvents(e.state, cur.events) }));
    } else if (e.type === 'phase') {
      const LABEL = { planning: 'Planning the shots…', executing: 'Generating shots…', stitching: 'Assembling the cut…' };
      if (LABEL[e.phase]) Message.info({ id: 'auto-phase', content: LABEL[e.phase] });
    } else if (e.type === 'step' && e.status === 'failed') {
      // Surface failures LOUDLY instead of a silently-empty clip.
      Message.error(`Shot ${(e.index ?? 0) + 1}/${e.total} (${e.agent}) failed: ${e.message || 'unknown error'}`);
    } else if (e.type === 'warning') {
      Message.info(e.message);
    } else if (e.type === 'film') {
      Message.success('Final cut assembled');
      updateTimeline((cur) => ({ ...cur, film: { url: e.url || e.path, assetId: e.assetId || null, builtAt: new Date().toISOString() } }));
    }
  }, [reconcileSessionNodes, updateTimeline]);

  // Non-bible board assets the user attached to CUT cards ride along as extra
  // reference entries (role 'ref') — per-cut picks, never auto-canonized into the
  // bible. Their ids are deterministic so card refEntryIds resolve against them.
  const extRefId = (a) => `ext-${a.nodeId || a.url}`;
  const cutAssetEntries = useCallback(() => {
    const seen = new Set();
    const out = [];
    nodesRef.current.filter((n) => n.type === 'cut').forEach((c) => {
      (c.data?.assetRefs || []).forEach((a) => {
        const eid = extRefId(a);
        if (!a.url || seen.has(eid)) return;
        seen.add(eid);
        out.push({ id: eid, role: 'ref', name: a.label || 'asset', url: a.url, locked: true });
      });
    });
    return out;
  }, []);

  // Build a production bound to the browser transport + this canvas's event sink.
  // The bible travels with the input so EVERY generative step references the look +
  // cast (the drift-killer) — see resolveInputs in production.js.
  const buildSession = useCallback((sources, initialState, blueprintOverride, sessionOpts = {}) => {
    // Trace-wrap the transport so every model call the producer makes (prompt, refs,
    // model, result) lands in the run log — without touching the shared engine.
    const transport = createBrowserTransport((apiKey || '').trim());
    const traced = { ...transport, client: traceRef.current.wrapClient(transport.client), stitch: traceRef.current.wrapStitch(transport.stitch) };
    // The blueprint (the user-reviewed SHOT cards) drives the producer verbatim — the
    // Storyboard / Story Builder / SHOT cards do all the planning; no auto shot-grammar.
    const blueprint = blueprintOverride;
    const session = createProduction(
      {
        idea: '',
        sources,
        targetSeconds: timeline.targetSeconds,
        bible: [...bibleRef.current, ...cutAssetEntries()],
        blueprint,
      },
      traced,
      { mode: initialState?.mode || 'auto', onEvent: handleSessionEvent, ...(initialState ? { initialState } : {}), ...sessionOpts },
    );
    sessionRef.current = session;
    return session;
  }, [apiKey, project.recipe, timeline.targetSeconds, handleSessionEvent, cutAssetEntries]);

  // ---- Timeline + Bible actions (the spine the whole UX hangs on) -------------

  // Auto-fill ("do it"): shoot the AD's explicit blueprint end to end. Plans come
  // from the Storyboard or the ad grammar only — never invented here.
  // Short Film has no batch "auto-fill": shots are planned (Build the story / Storyboard)
  // and shot from their SHOT cards (🎬) or "action". The timeline button just guides there.
  const handleAutoFill = useCallback(async () => {
    Message.info('Plan the shots first — 🎬 Build the story / Storyboard, then shoot the SHOT cards (🎬) or say “action”.');
  }, []);

  // ---- run-trace export (agent introspection) --------------------------------
  // Dump every prompt + action of the run to text, so the whole pipeline can be
  // critically re-assessed (paste it back here, or keep the .txt).
  const copyTrace = useCallback(() => {
    const text = traceRef.current.toText();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => Message.success(`Run log copied (${traceRef.current.entries.length} actions) — paste it to re-assess`),
        () => Message.error('Copy failed — use Download instead'),
      );
    } else { Message.error('Clipboard unavailable — use Download instead'); }
  }, []);

  const downloadTrace = useCallback(() => {
    const blob = new Blob([traceRef.current.toText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ad-run-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // "Generate the ad" (from the dock): lock the recipe framing + idea + duration onto
  // the project, then Auto-fill the cut from the now-tagged brand kit. The bible is
  // already complete (gaps were dropped as tagged nodes), so there's no gap-gen step.
  // Defer the run via a tick so handleAutoFill sees the just-written idea/targetSeconds
  // (the project prop updates on the next render, not in this closure).

  // ---- CUT cards: the review gate between intent and spend ---------------------
  // Laying out CUT cards never fires generation — it places one CUT card per beat on
  // the board (content + camera/motion + duration + asset edges); the user refines
  // them, shoots any single card with its 🎬, and "🎬 Action" shoots the rest.

  // Dashed prerequisite edges into the card: bible refs (via their board nodes) AND
  // per-cut attached board assets. Edges are SEQUENCE-only — references show as chips,
  // never as permanent edges.

  const onPatchCut = useCallback((id, p) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)));
  }, [setNodes]);

  // Attach one asset (a board node drop, or a Library item) to a cut. Bible-tagged
  // nodes toggle their entry on; anything else becomes a per-cut assetRef. This is
  // the route fresh agent variations take into a shot — and it stays curate-first:
  // attaching feeds ONE cut, it does not canonize into the bible.
  // Everything a PLATE attach must do to a card, computed PURELY from explicit inputs:
  // the plate chip + the plate's colorCast characters auto-added as bible refs (visible
  // chips — the direct consequence of casting the colors and tapping attach) + the
  // NAMED, correctly numbered FIRST FRAME lock. A machine lock leading the prompt is
  // REPLACED (refresh-on-reattach heals stale numbers); user prose below it is never
  // touched; a legacy hand-placed lock elsewhere in the text is left alone entirely.
  // Returns { patch, assigned } — `assigned` names the auto-attached cast for the toast.
  const composePlateAttachment = useCallback((card, plate, plateUrl) => {
    const bible = bibleRef.current || [];
    const refIds = [...(card.data.refIds || [])];
    const assetRefs = [...(card.data.assetRefs || [])];
    const plateEnt = (plate?.id && bible.find((b) => b.nodeId === plate.id)) || bible.find((b) => b.url === plateUrl);
    if (plateEnt) {
      if (!refIds.includes(plateEnt.id)) refIds.push(plateEnt.id);
    } else if (!assetRefs.some((a) => a.url === plateUrl)) {
      assetRefs.push({ nodeId: plate?.id || null, url: plateUrl, label: plate?.data?.label || 'Blocking plate' });
    }
    const cc = plate?.data?.colorCast || {};
    const resolveCast = (a) => (a ? (bible.find((b) => b.id === a.entryId) || bible.find((b) => a.nodeId && b.nodeId === a.nodeId) || bible.find((b) => b.role === 'character' && b.name === a.name)) : null);
    const assigned = [];
    ['BLUE', 'GREEN', 'YELLOW', 'RED', 'PURPLE'].forEach((color) => {
      const e = resolveCast(cc[color]);
      if (!e || !e.url) return;
      if (!refIds.includes(e.id)) refIds.push(e.id);
      assigned.push({ color, name: e.name || cc[color].name || 'the character', entryId: e.id });
    });
    const sentIds = refIds.filter((rid) => bible.some((b) => b.id === rid && b.url));
    const badgeOfEntry = (eid) => sentIds.indexOf(eid) + 1;
    const plateNum = plateEnt
      ? Math.max(1, badgeOfEntry(plateEnt.id))
      : sentIds.length + Math.max(0, assetRefs.findIndex((a) => a.url === plateUrl)) + 1;
    const cast = assigned.map((a) => ({ color: a.color, name: a.name, badge: badgeOfEntry(a.entryId) }));
    const lock = anchorBindingLine(plateNum, { mask: !!plate?.data?.previzMask, cast });
    const old = String(card.data.promptOverride || '');
    const patch = { refIds, assetRefs };
    if (old.startsWith('FIRST FRAME:')) {
      const rest = old.includes('\n\n') ? old.slice(old.indexOf('\n\n') + 2) : '';
      patch.promptOverride = `${lock}${rest ? `\n\n${rest}` : ''}`;
    } else if (!hasFrameLock(old)) {
      patch.promptOverride = `${lock}${old ? `\n\n${old}` : ''}`;
    }
    return { patch, assigned };
  }, []);

  const attachRefToCut = useCallback((cutId, payload) => {
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card || !payload?.url) return;
    const srcNode = payload.nodeId ? nodesRef.current.find((n) => n.id === payload.nodeId) : null;
    // Blocking plates (and legacy previz frames on old boards) get the FULL plate
    // treatment (chip + auto cast refs + named lock) on every path that lands here.
    if (srcNode?.data?.previzMask || srcNode?.data?.previz) {
      const { patch } = composePlateAttachment(card, srcNode, payload.url);
      onPatchCut(cutId, patch);
      return;
    }
    const ent = (payload.nodeId && bibleRef.current.find((b) => b.nodeId === payload.nodeId))
      || bibleRef.current.find((b) => b.url === payload.url);
    const refIds = card.data.refIds || [];
    const assetRefs = card.data.assetRefs || [];
    if (ent) {
      if (!refIds.includes(ent.id)) onPatchCut(cutId, { refIds: [...refIds, ent.id] });
      return;
    }
    if (assetRefs.some((a) => a.url === payload.url)) return;
    onPatchCut(cutId, { assetRefs: [...assetRefs, { nodeId: payload.nodeId || null, url: payload.url, label: payload.label || 'asset' }] });
  }, [onPatchCut, composePlateAttachment]);

  // Explicit attach for a blocking plate — dragging a node just MOVES it on the canvas
  // (the card's drop zone only hears the ⋮⋮ handle and Library drags), so the plate gets
  // its own button. Target = the SHOT card the plate's source image belongs to, else the
  // SELECTED card. attachRefToCut then does both halves: reference chip + the editable
  // color-binding LAYOUT line in the card's prompt.
  const attachPlateToCard = useCallback((id) => {
    const plate = nodesRef.current.find((n) => n.id === id);
    const url = plate && refUrl(plate);
    if (!url) { Message.warning('The plate is still rendering — attach it once it lands.'); return; }
    // An explicitly SELECTED card wins (the user pointed at it); the plate's source
    // card is the fallback when nothing is selected.
    const selected = nodesRef.current.find((n) => n.type === 'cut' && n.selected);
    const source = plate.data?.sourceCutId ? nodesRef.current.find((n) => n.id === plate.data.sourceCutId && n.type === 'cut') : null;
    const target = selected || source;
    if (!target) { Message.warning('Select a SHOT card first — then attach the plate.'); return; }
    // ONE pure computation, ONE patch: chip + auto cast refs (from the plate's colorCast)
    // + the named, correctly numbered FIRST FRAME lock. Re-attach refreshes a machine
    // lock in place (heals stale numbers); user prose below it is never touched.
    const fresh = nodesRef.current.find((n) => n.id === target.id) || target;
    const { patch, assigned } = composePlateAttachment(fresh, plate, url);
    onPatchCut(target.id, patch);
    const where = `SHOT ${(target.data?.cut ?? 0) + 1}${target.data?.beat ? ` · “${String(target.data.beat).slice(0, 24)}”` : ''}`;
    Message.success(assigned.length
      ? `Plate attached to ${where} — cast auto-attached (${assigned.map((a) => `${a.color.toLowerCase()} = ${a.name}`).join(', ')}); the named FIRST FRAME lock leads its prompt.`
      : `Plate attached to ${where} — the FIRST FRAME lock leads its prompt. Tip: “Cast colors” on the plate makes this fully automatic (names + numbers).`);
  }, [onPatchCut, composePlateAttachment]);

  // ---- map PROMOTE = THE PROJECTION MOMENT (no hidden LLM inside 🎬) ------------------
  // One tap on the floor plan births a SHOT card beside it (the storyboard-promote
  // pattern — no selection dance): ONE reason call reads the map + its stored brief
  // and writes the camera-relative blocking as the new card's prompt — visible,
  // editable; the brief is stashed as projectSource. 🎬 then shoots exactly what you
  // see. MAP_AS_SEEDANCE_REF stays false: with the map riding as a reference,
  // Seedance COMPOSITES the schematic into the take (circles, axis line, labels over
  // photoreal subjects) despite any read-only clause, while the projected TEXT alone
  // stages the geography correctly. The map is an AUTHORING artifact — the projection
  // carries its geometry into the prompt; the map itself never rides to Seedance.
  const MAP_AS_SEEDANCE_REF = false;
  // ---- TAKES OFF THE CANVAS ---------------------------------------------------------
  // The board shows the PLAN (cards, bonds, sequences); takes — the dailies bin — never
  // render as board nodes. The nodes still exist (persistence, viewer, timeline and the
  // resume poll all keep working) but stay permanently hidden via the RF `hidden` flag
  // (never serialized). The card face carries a 🎞 count chip that opens the Take
  // Library drawer — the ONE surface for renders. The self-guarded setNodes (same
  // reference when nothing changes) prevents effect loops.
  useEffect(() => {
    if (demoOverlay) return; // the demo replay owns `hidden` while it plays
    setNodes((ns) => {
      const cardIds = new Set(ns.filter((n) => n.type === 'cut').map((n) => n.id));
      const cardOfSatellite = (n) => {
        if (String(n.id).startsWith('grid-') && cardIds.has(String(n.id).slice(5))) return String(n.id).slice(5);
        if (n.parentId && String(n.parentId).startsWith('grid-') && cardIds.has(String(n.parentId).slice(5))) return String(n.parentId).slice(5);
        if (String(n.id).startsWith('shot-') && cardIds.has(String(n.id).slice(5))) return String(n.id).slice(5);
        return null;
      };
      const counts = new Map();
      ns.forEach((n) => {
        const cid = cardOfSatellite(n);
        if (cid && n.data?.kind === 'video') counts.set(cid, (counts.get(cid) || 0) + 1);
      });
      // Storyboard strip rows are hidden data nodes too (same contract as takes:
      // `hidden` never serializes, so it must be re-asserted continuously).
      const isStripRow = (n) => !!n.data?.keyframe && String(n.id).startsWith('sbpanel-') && /-\d+$/.test(String(n.id));
      let changed = false;
      const out = ns.map((n) => {
        if (isStripRow(n)) {
          if (!n.hidden) { changed = true; return { ...n, hidden: true }; }
          return n;
        }
        const cid = cardOfSatellite(n);
        if (cid) {
          if (!n.hidden) { changed = true; return { ...n, hidden: true }; }
          return n;
        }
        if (n.type === 'cut') {
          const c = counts.get(n.id) || 0;
          if ((n.data?.takeCount || 0) !== c) { changed = true; return { ...n, data: { ...n.data, takeCount: c } }; }
        }
        return n;
      });
      return changed ? out : ns;
    });
  }, [nodes, demoOverlay, setNodes]);

  // ---- SEQUENCE element handlers ---------------------------------------------------
  // Collapse hides the member cards (+ their take grids and docked shots) via the
  // React Flow `hidden` flag — same mechanism as the demo replay, never serialized
  // state loss; the bar stays as the sequence's compact face.
  const toggleSequenceCollapse = useCallback((seqId) => {
    const seq = nodesRef.current.find((n) => n.id === seqId);
    if (!seq) return;
    const collapsed = !seq.data?.collapsed;
    const memberIds = new Set(seq.data?.cardIds || []);
    const hideIds = new Set();
    nodesRef.current.forEach((n) => {
      if (memberIds.has(n.id)) hideIds.add(n.id);
      const gridOf = [...memberIds].find((cid) => n.id === `grid-${cid}` || n.parentId === `grid-${cid}` || n.id === `shot-${cid}` || n.parentId === cid);
      if (gridOf) hideIds.add(n.id);
    });
    setNodes((ns) => ns.map((n) => {
      if (n.id === seqId) return { ...n, data: { ...n.data, collapsed } };
      if (hideIds.has(n.id)) return { ...n, hidden: collapsed };
      return n;
    }));
  }, [setNodes]);

  const handleShootCutRef = useRef(null); // bridges declaration order (handleShootCut is defined below)

  // ONE take per tap: shoot the first un-rendered (or failed) card in chain order.
  // handleShootCut threads continuity from the card's incoming bond.
  const shootNextInSequence = useCallback((seqId) => {
    const seq = nodesRef.current.find((n) => n.id === seqId);
    if (!seq) return;
    const next = (seq.data?.cardIds || [])
      .map((cid) => nodesRef.current.find((n) => n.id === cid && n.type === 'cut'))
      .find((c) => c && !c.data?.shotUrl && c.data?.status !== 'running');
    if (!next) { Message.info('Every shot in this sequence is rendered — ▶ or Stitch when ready.'); return; }
    handleShootCutRef.current && handleShootCutRef.current(next.id);
  }, []);

  const removeSequenceNode = useCallback((seqId) => {
    // The element goes; cards and bonds stay (they are the real graph).
    setNodes((ns) => ns.map((n) => (n.hidden ? { ...n, hidden: false } : n)).filter((n) => n.id !== seqId));
  }, [setNodes]);

  const sequenceCtx = useMemo(() => ({
    onShootNext: shootNextInSequence,
    onToggleCollapse: toggleSequenceCollapse,
    onRemoveSequence: removeSequenceNode,
  }), [shootNextInSequence, toggleSequenceCollapse, removeSequenceNode]);

  // PROMOTE ALL — every RENDERED still on a storyboard becomes a SHOT card, in shot
  // order, laid as a column right of the panel: still = anchor lock, the shot's
  // FIGURES ride as identity refs (bible ids where the pool entry is bible-tagged,
  // per-card assets otherwise), the body's [Image N] tags renumbered
  // DETERMINISTICALLY to the card's real badge order (bible refs first, then the
  // anchor, then loose refs — same arithmetic as the plate lock), duration carried —
  // and consecutive cards arrive PRE-CHAINED with continuity edges. FREE: no
  // generation, no LLM. Text-only cards are skipped and counted honestly.
  // THE promote assembly — the strip's per-row Promote, the one road from storyboard
  // to filming: resolve figures →
  // chips, renumber [Image N] to live badges, motion = the prompt, audio verbatim,
  // K1 = START still (+ K2 = END frame when the pair rendered). Deterministic — the
  // smart pass is the card's own Compose button, never hidden in a free gesture.
  const layAnchoredCard = useCallback((kf, sShot, pool, cut, pos) => {
      const url = kf && refUrl(kf);
      if (!kf?.data?.keyframe || !url) return null;
      const body0 = String(kf.data.body || sShot.body || '').trim();
      const { ordered, body } = resolveShotRefs({ ...sShot, body: body0 }, pool);
      // Split the figure refs: bible-tagged entries become refIds (badges 1..k),
      // the anchor still is the FIRST assetRef (badge k+1), loose figure refs follow.
      const refIds = [];
      const looseRefs = [];
      // Collect the bible/loose refs first, then apply the manual's order-=-weight
      // rule: FACE plates lead the send order (its documented ID-drift fix). Badges
      // are computed AFTER the sort, so the body's renumbered [Image N] tags stay
      // consistent with what actually rides.
      const attachKind = ordered.map((p) => {
        // Pool entryIds drifted from bible ids across reworks — resolve the bible entry
        // by id, node OR url so casting lands as proper refIds (identity chips), not loose.
        const be = bibleRef.current.find((b) => b.url && (b.id === p.entryId || (p.nodeId && b.nodeId === p.nodeId) || b.url === p.url));
        if (be) {
          if (!refIds.includes(be.id)) refIds.push(be.id);
          return { entryId: be.id };
        }
        if (p.url) {
          if (!looseRefs.some((a) => a.url === p.url)) looseRefs.push({ nodeId: p.nodeId || null, url: p.url, label: p.label || 'ref' });
          return { looseUrl: p.url };
        }
        return {};
      });
      const isFacePlate = (eid) => /·\s*face\s*$/i.test(String(bibleRef.current.find((b) => b.id === eid)?.name || ''));
      refIds.sort((a, b) => (isFacePlate(b) ? 1 : 0) - (isFacePlate(a) ? 1 : 0));
      const badgeOfAttach = attachKind.map((k) => (  // attach-order index (1-based) → final badge
        k.entryId ? refIds.indexOf(k.entryId) + 1
          : (k.looseUrl ? -(looseRefs.findIndex((a) => a.url === k.looseUrl) + 1) : 0) // negative = loose slot, resolved below
      ));
      // body is numbered 1..k in ATTACH order (resolveShotRefs) → map to real badges
      // via a two-pass sentinel swap (loose refs sit directly after the bible plates —
      // the still no longer occupies a ref slot, it rides as the START ANCHOR, which
      // the pinned compiler appends AFTER every plate).
      const renumber = (t) => {
        let m = t;
        badgeOfAttach.forEach((b, idx) => { m = m.split(`[Image ${idx + 1}]`).join(`@@B${idx + 1}@@`); });
        badgeOfAttach.forEach((b, idx) => {
          // Loose refs sit AFTER the START-still chip (assetRefs[0] = the still —
          // keyframes are POINTERS to chips now, the still occupies a real slot).
          const finalBadge = b > 0 ? b : (b < 0 ? refIds.length + 1 + (-b) : 0);
          m = m.split(`@@B${idx + 1}@@`).join(finalBadge ? `[Image ${finalBadge}]` : '');
        });
        return m;
      };
      const mapped = renumber(body);
      // The planner's MOTION field (what happens, video grammar) is the card's shoot
      // prompt when present — the body stays the still's language. Same [Image N]
      // renumbering applies (both fields share the pool numbering).
      const motion0 = String(sShot.motion || '').trim();
      const mappedMotion = motion0 ? renumber(resolveShotRefs({ ...sShot, body: motion0 }, pool).body) : '';
      // The anchors carry their WORDING (manual: text and image say the same thing) —
      // START = the still's description, END = the exiting state, badges renumbered.
      const exiting0 = String(sShot.exiting || '').trim();
      const mappedExiting = exiting0 ? renumber(resolveShotRefs({ ...sShot, body: exiting0 }, pool).body) : '';
      const idPrefix = `film-${Date.now().toString(36)}${(laySeqRef.current += 1).toString(36)}`;
      // A SEQUENCE reads top → bottom: one COLUMN — long scripts scroll naturally;
      // the bond arcs from a card's right dot down to the next card's left dot.
            storyboardPanelRef.current({
        index: 0, cut, idPrefix, title: sShot.beat || kf.data.beat || `Shot ${(Number(kf.data.index) || 0) + 1}`,
        action: '', promptOverride: mappedMotion || mapped, framing: '',
        shotTemplate: sShot.shotTemplate || kf.data.shotTemplate || 'medium-shot',
        durationSec: Math.min(maxShotSeconds(defaultVideoModelKey()), Math.max(5, Math.round(Number(sShot.durationSec) || 10))), // model CEILING, never pace — carve already paced
        refEntryIds: refIds, audio: sShot.audio || '',
      }, pos);
      const cardId = `${idPrefix}-0`;
      // The still IS the card's START anchor — ONE mechanism: the pinned grammar's
      // composition binding replaces the old FIRST-FRAME lock text entirely. A rendered
      // pair carries its END frame across as the END anchor (nodeId null — the END
      // lives on the START node's data, not as its own board node).
      // The stills are CHIPS (first + last assetRefs); the keyframes POINT at them —
      // each image rides once.
      const beatLabel = sShot.beat || `Frame ${(Number(kf.data.index) || 0) + 1}`;
      const endUrl = kf.data.endStill?.url ? (kf.data.endStill.cacheUrl || kf.data.endStill.url) : '';
      onPatchCut(cardId, {
        assetRefs: [
          { nodeId: kf.id, url, label: beatLabel },
          ...looseRefs,
          ...(endUrl ? [{ nodeId: null, url: endUrl, label: `${beatLabel} · end` }] : []),
        ],
        keyframes: [
          { nodeId: kf.id, url, label: beatLabel, desc: mapped, pickedAt: Date.now() },
          ...(endUrl ? [{ nodeId: null, url: endUrl, label: `${beatLabel} · end`, desc: mappedExiting, pickedAt: Date.now() }] : []),
        ],
      });
      return cardId;
  }, [onPatchCut]);


  const promoteMapToCard = useCallback(async (mapId) => {
    const map = nodesRef.current.find((n) => n.id === mapId);
    const mapUrl = map && (map.data?.cacheUrl || map.data?.url);
    if (!mapUrl) { Message.warning('The schematic is still rendering — promote it once it lands.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    if (!storyboardPanelRef.current) return;
    const moment = String(map.data?.floorPlanBrief || '').trim();
    if (!moment) { Message.warning('This plan has no stored scene text — regenerate it from a Brief.'); return; }
    if (map.data?.projecting) return; // one projection at a time — the card shows the spinner
    setNodes((ns) => ns.map((n) => (n.id === mapId ? { ...n, data: { ...n.data, projecting: true } } : n)));
    traceRef.current.startRun({ note: 'Agent · Previz · projection' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { prompt } = await projectShot({ mapUrl: absLocalMediaUrl(mapUrl), moment, camera: '' }, ctx);
      let out = prompt;
      if (!MAP_AS_SEEDANCE_REF) {
        const lines = out.split('\n');
        if (/blocking MAP/i.test(lines[0] || '')) lines.shift();
        out = lines.join('\n').trim();
      }
      // Lay the card beside the map (fresh card: the map is its FIRST reference, so the
      // projection's "[Image 1]" is already correct — no renumbering).
      const base = freeOrigin({ w: CUT_COL_W, h: CUT_ROW_H, preferred: { x: (map.position?.x || 0) + 400, y: map.position?.y || 0 } });
      const cut = nodesRef.current.filter((n) => n.type === 'cut').reduce((m, n) => Math.max(m, Number.isFinite(n.data?.cut) ? n.data.cut : -1), -1) + 1;
      const idPrefix = `film-${Date.now().toString(36)}${(laySeqRef.current += 1).toString(36)}`;
      storyboardPanelRef.current({
        index: 0, cut, idPrefix, title: map.data?.label || 'Blocked shot',
        action: '', promptOverride: out, framing: '',
        shotTemplate: 'medium-shot', durationSec: 10,
        refEntryIds: [], audio: '',
      }, base);
      onPatchCut(`${idPrefix}-0`, {
        ...(MAP_AS_SEEDANCE_REF ? { assetRefs: [{ nodeId: mapId, url: mapUrl, label: 'Schematic' }] } : {}),
        mapRef: { nodeId: mapId, url: mapUrl, ...(MAP_AS_SEEDANCE_REF ? {} : { textOnly: true }) },
        projectSource: moment,
      });
      Message.success(`SHOT ${cut + 1} laid from the schematic — the projected blocking is its prompt (yours to edit); 🎬 shoots exactly what you see.`);
    } catch (e) {
      Message.error(`Projection failed: ${e.message}`);
    } finally {
      setNodes((ns) => ns.map((n) => (n.id === mapId ? { ...n, data: { ...n.data, projecting: false } } : n)));
    }
  }, [apiKey, freeOrigin, onPatchCut, setNodes]);

  // Lay ONE panel as a SHOT card — the Story's prompt rides verbatim as promptOverride.
  storyboardPanelRef.current = (panel, base) => {
    if (!panel || !base) return;
    // idPrefix lets a parallel generator lay 'cut' cards with distinct ids so they don't
    // collide with — or get pruned alongside — the Story's cut-N (default prefix 'cut').
    const id = `${panel.idPrefix || 'cut'}-${panel.index}`;
    const sec = Math.min(maxShotSeconds(defaultVideoModelKey()), Math.max(5, panel.durationSec || 10));
    const cine = shotTemplateCinematography(panel.shotTemplate, projectRef.current?.genre?.line || '');
    // The content a (re)derive writes from the panel — the prompt/camera/action/refs. NOT
    // the take (shotUrl/status) or the user's own asset attachments; those survive.
    const derived = {
      beat: panel.title,
      cuts: [{ action: panel.framing ? `${panel.framing}. ${panel.action}` : panel.action, seconds: Math.min(6, sec) }],
      ...(panel.promptOverride != null ? { promptOverride: panel.promptOverride } : {}),
      cinematography: cine,
      shotTemplate: panel.shotTemplate || '',
      cinePreset: (SHOT_TEMPLATE_BY_ID[panel.shotTemplate] && SHOT_TEMPLATE_BY_ID[panel.shotTemplate].name) || '',
      audio: panel.audio || '',
      durationSec: sec,
      refIds: panel.refEntryIds || [],
      direct: true,
    };
    // `cols` (default 3) sets the grid width; the Shot-division panel passes cols=shot-count for
    // ONE left-to-right row. `parentId`/`reposition` let it (re)parent the cards onto its panel
    // group and re-place them each turn (other callers keep position on re-derive).
    const cols = panel.cols || 3;
    const position = { x: base.x + (panel.index % cols) * CUT_COL_W, y: base.y + Math.floor(panel.index / cols) * CUT_ROW_H };
    setNodes((ns) => {
      if (ns.some((n) => n.id === id)) {
        // Re-derive → refresh content, KEEP the take + asset attachments.
        return ns.map((n) => (n.id === id ? {
          ...n,
          ...(panel.reposition ? { position } : {}),
          ...(panel.parentId ? { parentId: panel.parentId } : {}),
          data: { ...n.data, ...derived },
        } : n));
      }
      const card = {
        id,
        type: 'cut',
        position,
        ...(panel.parentId ? { parentId: panel.parentId } : {}),
        // Asset/media attachments are CREATE-only (selection pre-population) — a
        // re-derive refreshes `derived` but never touches what the user attached.
        data: { cut: panel.cut ?? panel.index, ...derived, assetRefs: panel.assetRefs || [], audioRefs: panel.audioRefs || [], videoRefs: panel.videoRefs || [] },
      };
      return [...ns, card];
    });
  };

  // A SHOT card → one blueprint shot: the Story's prompt (verbatim, + camera/look/audio)
  // and the card's REAL refs go straight to Seedance, in [Image1..N] order. keepTake
  // carries an existing take along so Action doesn't re-shoot it.
  // A card's attached media ref (audio clip / video) → a url Seedance can actually
  // consume. data: passes straight through (/api/seedance stages it to TOS presigned);
  // a local media-store url is fetched same-origin and inlined; a remote http url is
  // inlined too when CORS allows, else passed raw for Seedance to fetch.
  // A media ref travels as a URL, never as bytes: a store url is presigned server-side
  // from the already-mirrored TOS object (the transport handles data:/http too), so a
  // reference video adds ~100 chars to the request instead of a base64 payload. Prefer
  // the LIVE node's current durable url over the one stamped at attach time.
  const resolveMediaRefUrl = useCallback(async (ref) => {
    const live = ref?.nodeId ? nodesRef.current.find((x) => x.id === ref.nodeId) : null;
    const u = String((live && (live.data?.cacheUrl || live.data?.url)) || ref?.url || '');
    return u || null;
  }, []);

  // The DURABLE source for a take/video url the board knows: card fields (shotUrl,
  // timeline events) hold the RAW remote url, which expires — but the take NODE holding
  // the same url has a checked-in store copy. Look it up and absolutize, so server
  // routes (last-frame, frames, stitch) fetch loopback → disk, else the TOS mirror —
  // continuity frames and Stitch keep working on expired or cloud-restored takes.
  const durableVideoUrl = useCallback((rawUrl) => {
    if (!rawUrl) return rawUrl;
    const n = nodesRef.current.find((x) => x.data?.kind === 'video' && (x.data?.url === rawUrl || x.data?.cacheUrl === rawUrl));
    return absLocalMediaUrl(n?.data?.cacheUrl || rawUrl);
  }, []);

  // A card's attached media refs (arrays; migrates the earlier single-ref fields) →
  // urls Seedance can consume, resolved in chip order.
  const resolveCardMediaRefs = useCallback(async (card) => {
    const audios = card.data.audioRefs || (card.data.audioRef ? [card.data.audioRef] : []);
    const videos = card.data.videoRefs || (card.data.videoRef ? [card.data.videoRef] : []);
    const audioRefUrls = (await Promise.all(audios.map(resolveMediaRefUrl))).filter(Boolean);
    // Videos also carry their Library asset:// id (looked up LIVE) — the shoot's
    // person-screen fallback retries a screened clip as the trusted asset before
    // dropping it, exactly like image refs.
    const resolvedVideos = await Promise.all(videos.map(async (ref) => ({
      url: await resolveMediaRefUrl(ref),
      assetId: (ref?.nodeId && nodesRef.current.find((x) => x.id === ref.nodeId)?.data?.assetId) || null,
    })));
    const kept = resolvedVideos.filter((v) => v.url);
    return { audioRefUrls, videoRefUrls: kept.map((v) => v.url), videoRefAssetIds: kept.map((v) => v.assetId) };
  }, [resolveMediaRefUrl]);

  // Resolve a card's ordered keyframe POINTERS against its enabled chips → [{ptr, idx}]
  // (1-based chip positions; dangling + adjacent-duplicate pointers dropped). Shared by
  // the shoot path and Compose so both see the same K1..Kn.
  const cardKfPairs = (data, baseRefs) => {
    const kfIndexOf = (a) => {
      if (!a || !a.url) return 0;
      const i2 = baseRefs.findIndex((r) => (a.nodeId && r.nodeId === a.nodeId) || r.url === a.url);
      return i2 < 0 ? 0 : i2 + 1;
    };
    const ptrs = (Array.isArray(data.keyframes) && data.keyframes.length)
      ? data.keyframes
      : [data.startAnchor, data.endAnchor].filter(Boolean); // legacy pair folds in
    return ptrs.map((ptr) => ({ ptr, idx: kfIndexOf(ptr) })).filter((x) => x.idx > 0)
      .filter((x, i2, arr) => i2 === 0 || x.idx !== arr[i2 - 1].idx);
  };

  const shotFromCard = useCallback((c, { keepTake = true, audioRefUrls = [], videoRefUrls = [], videoRefAssetIds = [] } = {}) => {
    const refEntryIds = [...(c.data.refIds || []), ...(c.data.assetRefs || []).map(extRefId)];
    const baseRefs = shotReferences(c.data, bibleRef.current);
    // The DP look layer (card's ＋ cinematography section) joins the Camera preset's
    // line into ONE LOOK — labeled, chip order, empty fields silently absent.
    const cineLook = [['lens', 'lens'], ['light', 'light'], ['grade', 'grade'], ['move', 'camera']]
      .map(([k, label]) => { const v = String((c.data.cine || {})[k] || '').trim(); return v ? `${label}: ${v}` : ''; })
      .filter(Boolean).join(' · ');
    // ---- KEYFRAME-PINNED PATH -----------------------------------------------------
    // A KEYFRAME is a POINTER to one of the card's ENABLED reference chips — the image
    // rides ONCE, at its chip position, and the binding line cites that [Image i]
    // (a ref never rides twice). A pointer whose chip was removed
    // or toggled off resolves to nothing — the card falls back to the classic path
    // and the face warns.
    const kfPairs = cardKfPairs(c.data, baseRefs);
    const kfIndices = kfPairs.map((x) => x.idx);
    const startIdx = kfIndices[0] || 0;
    if (startIdx) {
      const refs = baseRefs;
      const motion = composePinnedShotPrompt({
        // The keyframe chips carry composition, not identity — exclude them from the
        // subject-definition header (defining a still as a person reads as nonsense).
        subjects: refs.map((r, i3) => ({ index: i3 + 1, name: r.name, role: r.role }))
          .filter((sj) => sj.name && !kfIndices.includes(sj.index)),
        shots: [{
          kfIndices,
          startDesc: kfPairs[0]?.ptr?.desc || '',
          endDesc: kfIndices.length > 1 ? (kfPairs[kfPairs.length - 1]?.ptr?.desc || '') : '',
          action: c.data.promptOverride || '',
          move: (SHOT_TEMPLATE_BY_ID[c.data.shotTemplate] || {}).move || '',
          audio: c.data.audio || '',
        }],
        cinematography: [String(c.data.cinematography || '').trim(), cineLook].filter(Boolean).join(' · '),
        audioRefCount: audioRefUrls.length,
        videoRefCount: videoRefUrls.length,
        audioRoles: (c.data.audioRefs || []).map((r) => r.role || ''),
        videoRoles: (c.data.videoRefs || []).map((r) => r.role || ''),
        modelKey: videoModelKeyOf(c.data.videoModel),
      });
      return {
        beat: c.data.beat,
        direct: true,
        motion,
        camera: 'auto',
        durationSec: Math.min(maxShotSeconds(videoModelKeyOf(c.data.videoModel)), Math.max(5, Math.round(Number(c.data.durationSec) || 10))),
        refEntryIds,
        refUrls: refs.map((r) => r.url),
        refAssetIds: refs.map((r) => r.assetId || null),
        firstFrameUrl: null,
        resolution: clampResolution(videoModelKeyOf(c.data.videoModel), c.data.resolution),
        ratio: c.data.ratio || '21:9', // cinematic scope by default
        generateAudio: c.data.generateAudio,
        seed: c.data.seed,
        modelKey: videoModelKeyOf(c.data.videoModel),
        ...(audioRefUrls.length ? { audioRefUrls } : {}),
        ...(videoRefUrls.length ? { videoRefUrls, videoRefAssetIds } : {}),
        ...(keepTake && c.data.shotUrl ? { shotUrl: c.data.shotUrl } : {}),
      };
    }
    const references = baseRefs;
    const motion = composeFilmShotPrompt({
      prompt: c.data.promptOverride || '',
      shotTemplate: c.data.shotTemplate || '',
      cinematography: [String(c.data.cinematography || '').trim(), cineLook].filter(Boolean).join(' · '),
      audio: c.data.audio || '',
    });
    return {
      beat: c.data.beat,
      direct: true,
      motion,
      camera: 'auto',
      durationSec: Math.min(maxShotSeconds(videoModelKeyOf(c.data.videoModel)), Math.max(5, Math.round(Number(c.data.durationSec) || 10))),
      refEntryIds,
      refUrls: references.map((r) => r.url),
      // Parallel to refUrls: a registered portrait-library id (or null) per ref, so the
      // shoot sends person/place plates as image_asset_id (trusted) instead of a screened url.
      refAssetIds: references.map((r) => r.assetId || null),
      firstFrameUrl: null,
      // Standard Seedance 2.0 params edited on the card (fall back to engine defaults).
      // Clamp resolution to what the chosen endpoint allows (Mini caps at 720p).
      resolution: clampResolution(videoModelKeyOf(c.data.videoModel), c.data.resolution),
      ratio: c.data.ratio || '21:9', // cinematic scope by default
      generateAudio: c.data.generateAudio,
      seed: c.data.seed, // the card's own seed (if set) — the global sequence seed is gone
      // Which Seedance endpoint to shoot on — the card's pick (default vs Mini).
      modelKey: videoModelKeyOf(c.data.videoModel),
      // The card's attached media (pre-resolved to data:/http, chip order) — Seedance's
      // reference AUDIO tracks and reference VIDEOS (≤15s each): music + voices the take
      // realizes, camera/motion it follows, instead of inventing its own.
      ...(audioRefUrls.length ? { audioRefUrls } : {}),
      ...(videoRefUrls.length ? { videoRefUrls, videoRefAssetIds } : {}),
      ...(keepTake && c.data.shotUrl ? { shotUrl: c.data.shotUrl } : {}),
    };
  }, []);

  // The generated shot lands as its OWN board node DOCKED under its SHOT card — a child
  // (parentId) positioned at the card's bottom, so it travels with the card but stays a
  // separate, draggable video element (never fused into the card). Upsert by id so a
  // re-shoot replaces it in place. (The card keeps data.shotUrl only for status/re-shoot.)
  const upsertShotNodeForCard = useCallback((cardId, url) => {
    if (!url) return;
    setNodes((ns) => {
      const card = ns.find((n) => n.id === cardId && n.type === 'cut');
      if (!card) return ns;
      const shotId = `shot-${cardId}`;
      const h = Math.round(card.measured?.height || card.height || NODE_FALLBACK.cut.h);
      const pos = { x: 0, y: h + 10 }; // relative to the card → docked just under it
      const label = `Shot · ${card.data?.beat || `cut ${(card.data?.cut ?? 0) + 1}`}`;
      if (ns.some((n) => n.id === shotId)) {
        return ns.map((n) => (n.id === shotId
          ? { ...n, parentId: cardId, position: pos, data: { ...n.data, kind: 'video', url, label } }
          : n));
      }
      // Child must follow its parent in the array — concat appends after the card.
      return ns.concat({ ...createAssetNode({ kind: 'video', url, label, position: pos }), id: shotId, parentId: cardId });
    });
  }, [setNodes]);

  // Live session → card feedback: running/failed/keyframe/shot land on the cards
  // (border + status tag) as the mapped steps progress; the shot also docks under the card.
  const wireCutSession = useCallback((session, cardIdByStep) => {
    session.on((e) => {
      const hit = e.stepId ? cardIdByStep.get(e.stepId) : null;
      if (!hit) return;
      if (e.type === 'step') {
        // Direct cards have only an animate step — 'running' fires on either kind.
        if (e.status === 'running') onPatchCut(hit.cardId, { status: 'running' });
        if (e.status === 'failed') onPatchCut(hit.cardId, { status: 'failed' });
      } else if (e.type === 'asset') {
        if (hit.kind === 'kf' && e.kind === 'image') onPatchCut(hit.cardId, { keyframeUrl: e.url });
        if (hit.kind === 'anim' && e.kind === 'video') { onPatchCut(hit.cardId, { shotUrl: e.url, status: 'shot', shotAt: Date.now() }); upsertShotNodeForCard(hit.cardId, e.url); }
      }
    });
  }, [onPatchCut, upsertShotNodeForCard]);

  // Photoreal cast plates rejected by Seedance as raw urls ("input image may contain real
  // person") must ride as a TRUSTED portrait-library asset (image_asset_id / asset://).
  // Before a shoot, register any referenced plate/frame that has no assetId yet → preserveAsset
  // stamps a stable assetId; patch the node AND bibleRef so the imminent shotFromCard reads it.
  // Two kinds qualify:
  //  - an http(s) bible plate (auto-tagged Cast & World plates skip the tag-time preserve), and
  //  - a CACHED FRAME, whose url is now a relative `/api/film/asset?…` (a hash-addressed local
  //    file). Registering ONCE and persisting the assetId means every later shoot/take reuses that
  //    ONE asset — no re-upload, no duplicate ModelArk asset per take. A frame keeps its durable
  //    cacheUrl for display (don't swap in the expiring TOS url); an http plate swaps to the
  //    preserved stable url.
  const ensureRefsRegistered = useCallback(async (card) => {
    const refIds = card?.data?.refIds || [];
    if (!refIds.length) return;
    const targets = (bibleRef.current || []).filter((e) => refIds.includes(e.id) && e.url && !e.assetId
      && (/^https?:\/\//.test(e.url) || isLocalMediaUrl(e.url)));
    for (const e of targets) {
      try {
        const isCache = isLocalMediaUrl(e.url);
        const src = isCache ? absLocalMediaUrl(e.url) : e.url;
        const { url, assetId, objectKey } = await preserveAsset(src, e.name); // eslint-disable-line no-await-in-loop
        if (!assetId) continue;
        const nodeId = String(e.id).startsWith('bible-') ? String(e.id).slice(6) : e.nodeId;
        const patch = isCache ? { assetId, objectKey, preserved: true } : { url, assetId, objectKey, preserved: true };
        setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
        bibleRef.current = (bibleRef.current || []).map((b) => (b.id === e.id ? { ...b, assetId, ...(isCache ? {} : { url }) } : b));
      } catch { /* best-effort: a failure falls back to the raw url (may still be filtered) */ }
    }
  }, [setNodes]);

  // Final safety net before a shoot: Seedance content-SCREENS raw `image_url` reference
  // images and rejects any that "may contain sensitive information" (a real person). That
  // hits not just cast plates but the CONTINUITY frame (a still lifted from the prior shot)
  // and any non-bible attached ref — none of which ensureRefsRegistered covers. So register
  // EVERY shot reference that still lacks an assetId as a TRUSTED asset and send it as
  // image_asset_id instead. Returns refAssetIds (parallel to refUrls) with the gaps filled;
  // best-effort — a preserve failure leaves that one as a raw url (and may still be screened).
  const registerShotRefs = useCallback(async (refUrls = [], refAssetIds = []) => {
    const out = refUrls.map((_, i) => refAssetIds[i] || null);
    await Promise.all(refUrls.map(async (url, i) => {
      if (out[i] || !url) return;
      // A local-store ref (a checked-in frame, `/api/film/media?…` or the legacy
      // `/api/film/asset?…`) is same-origin — make it absolute so the preserve server can
      // fetch the file (loopback) → TOS asset. Raw http refs preserve directly;
      // asset:// / data: are handled downstream.
      const u = absLocalMediaUrl(url);
      if (!/^https?:\/\//.test(u)) return;
      try { const { assetId } = await preserveAsset(u, `shot-ref-${i + 1}`); if (assetId) out[i] = assetId; }
      catch { /* leave as a raw url */ }
    }));
    return out;
  }, []);

  // 🎬 on a single card: shoot JUST this cut (keyframe + animate, no stitch) — the
  // same engine, so retries and History tracing come along. The take lands on the
  // card, the board and the timeline at the cut's slot; re-clicking re-shoots.
  // 🎬 on a single card: NON-BLOCKING. Drop an in-progress (loading) video element on the
  // board IMMEDIATELY, then shoot in the background — so you can fire as MANY follow-up
  // takes as you want by clicking 🎬 again, each landing as its own video that fills in when
  // ready. A direct Seedance call (no session) keeps the takes fully independent + parallel.
  // RESUME pending takes after a reload/restore: the 🎬 poll loop dies with the page,
  // but the Ark TASK keeps rendering — its id is persisted on the take node, so any
  // take found with a taskId and no url gets its poll re-attached and lands as if the
  // page never blinked (the status route even checked the bytes in server-side while
  // nobody was watching). Failures mark the take honestly instead of spinning forever.
  const resumedTakesRef = useRef(new Set());
  useEffect(() => {
    if (!apiKey?.trim() && !serverKeyedRef.current) return;
    const pending = nodes.filter((n) => n.data?.kind === 'video' && n.data?.taskId && !n.data?.url && !resumedTakesRef.current.has(n.id));
    if (!pending.length) return;
    const client = createBrowserClient((apiKey || '').trim());
    pending.forEach((take) => {
      resumedTakesRef.current.add(take.id);
      setNodes((ns) => ns.map((n) => (n.id === take.id ? { ...n, data: { ...n.data, loading: true, error: undefined } } : n)));
      (async () => {
        try {
          const { videoUrl, lastFrameUrl, videoCacheUrl, lastFrameCacheUrl } = await client.pollVideo({ taskId: take.data.taskId });
          setNodes((ns) => ns.map((n) => (n.id === take.id ? { ...n, data: { ...n.data, url: videoUrl, cacheUrl: videoCacheUrl || n.data.cacheUrl, loading: false, taskId: null, label: String(n.data.label || 'Take').replace(/…$/, '') } } : n)));
          if (take.data.cutId) onPatchCut(take.data.cutId, { status: 'shot', shotUrl: videoUrl, lastFrameUrl: lastFrameCacheUrl || lastFrameUrl || null });
          Message.success('A take that was rendering before the reload has landed.');
        } catch (e) {
          setNodes((ns) => ns.map((n) => (n.id === take.id ? { ...n, data: { ...n.data, loading: false, taskId: null, error: `Interrupted take could not be resumed: ${e.message}`, label: 'Take failed' } } : n)));
          if (take.data.cutId) onPatchCut(take.data.cutId, { status: 'failed' });
        }
      })();
    });
  }, [nodes, apiKey, setNodes, onPatchCut]);

  const handleShootCut = useCallback(async (cutId) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card) return;
    // Continuity: a CHAIN EDGE into this card is authoritative — its source's last
    // frame threads in. On a board with a chain, an edge-less card is a HARD CUT (no
    // threading). A board with ZERO chain edges keeps the legacy nearest-earlier
    // heuristic so old projects don't change behavior.
    // Continuity has ONE mechanism: the card's own keyframes — no hidden last-frame
    // handoffs between takes.
    // Drop the LOADING take into this card's SHOTGRID — a container beside the card that
    // accumulates every take. New takes append as one more cell; the grid grows by rows.
    // (Takes are children of the grid but NOT extent-clamped, so they're draggable out.)
    const gridId = `grid-${cutId}`;
    const takeId = `shot-${cutId}-${Date.now().toString(36)}`;
    const takeNo = nodesRef.current.filter((n) => n.parentId === gridId).length + 1;
    setNodes((ns) => {
      const slot = ns.filter((n) => n.parentId === gridId).length;
      let next = ns;
      if (!ns.some((n) => n.id === gridId)) {
        const cardW = Math.round(card.measured?.width || card.width || NODE_FALLBACK.cut.w);
        const grid = createGroupNode({
          label: `Shots · ${(card.data?.beat || '').slice(0, 24)}`,
          position: { x: (card.position?.x || 0) + cardW + 40, y: card.position?.y || 0 },
          width: GROUP_PAD * 2 + TAKE_COLS * CELL_W,
          height: GROUP_HEADER + GROUP_PAD + TAKE_CELL_H,
        });
        next = next.concat({ ...grid, id: gridId }); // parent BEFORE child (RF ordering)
      }
      const tn = createAssetNode({
        kind: 'video', url: '', label: `Take ${takeNo}…`,
        position: { x: GROUP_PAD + (slot % TAKE_COLS) * CELL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(slot / TAKE_COLS) * TAKE_CELL_H },
      });
      next = next.concat({ ...tn, id: takeId, parentId: gridId, data: { ...tn.data, loading: true } });
      // Grow the grid to fit the new row count (keep width in sync with the col count too).
      const rows = Math.floor(slot / TAKE_COLS) + 1;
      const w = GROUP_PAD * 2 + TAKE_COLS * CELL_W;
      const h = GROUP_HEADER + GROUP_PAD + rows * TAKE_CELL_H;
      return next.map((n) => (n.id === gridId ? { ...n, style: { ...n.style, width: w, height: h } } : n));
    });
    onPatchCut(cutId, { status: 'running' });
    traceRef.current.startRun({ note: `Shoot · ${card.data.beat || `cut ${(card.data.cut ?? 0) + 1}`} (take ${takeNo})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    // Fire-and-forget so the 🎬 button NEVER blocks — every click is an independent take.
    (async () => {
      try {
        await ensureRefsRegistered(card);
        const { audioRefUrls, videoRefUrls, videoRefAssetIds } = await resolveCardMediaRefs(card);
        const shot = shotFromCard(card, { keepTake: false, audioRefUrls, videoRefUrls, videoRefAssetIds });
        const refAssetIds = await registerShotRefs(shot.refUrls, shot.refAssetIds);
        // Seedance content-SCREENS every reference image and rejects any it judges to "contain
        // sensitive information / a real person" — photoreal cast plates trip it EVEN as fully
        // registered asset:// refs (this endpoint has no consented-identity bypass). It reports
        // the FIRST offender as `content[N].image_url`; so DROP that ref and retry, looping
        // until the take renders. Report how many refs the screen skipped (consistency hit).
        const { taskId, droppedRefs, healedAssets } = await animateWithRefFallback(shot, refAssetIds, ctx);
        // Persist the Ark task on the take node: if the page dies mid-render, the
        // reloaded board re-attaches the poll (resume effect) instead of orphaning
        // a billed generation. cutId rides along so resume can settle the card too.
        resumedTakesRef.current.add(takeId);
        setNodes((ns) => ns.map((n) => (n.id === takeId ? { ...n, data: { ...n.data, taskId, cutId } } : n)));
        // Stale asset ids healed mid-shoot → persist the fresh ids on the nodes AND
        // bible entries that carried them, so the next shoot doesn't re-heal.
        if (healedAssets?.length) {
          const byStale = new Map(healedAssets.filter((h) => h.staleId).map((h) => [h.staleId, h.assetId]));
          setNodes((ns) => ns.map((n) => (byStale.has(n.data?.assetId)
            ? { ...n, data: { ...n.data, assetId: byStale.get(n.data.assetId) || null, preserved: !!byStale.get(n.data.assetId) } }
            : n)));
          bibleRef.current = (bibleRef.current || []).map((b) => (byStale.has(b.assetId) ? { ...b, assetId: byStale.get(b.assetId) || null } : b));
          Message.info(`${healedAssets.length} reference${healedAssets.length === 1 ? '' : 's'} had a stale registration — re-registered on the fly.`);
        }
        if (droppedRefs) Message.warning(`${droppedRefs} reference image${droppedRefs === 1 ? '' : 's'} skipped on take ${takeNo} — the video model's content screen flagged ${droppedRefs === 1 ? 'it' : 'them'} as sensitive (this take is less anchored).`);
        const { videoUrl, lastFrameUrl, videoCacheUrl, lastFrameCacheUrl } = await ctx.client.pollVideo({ taskId });
        setNodes((ns) => ns.map((n) => (n.id === takeId ? { ...n, data: { ...n.data, url: videoUrl, cacheUrl: videoCacheUrl || n.data.cacheUrl, loading: false, taskId: null, label: `Take ${takeNo}` } } : n)));
        onPatchCut(cutId, { status: 'shot', shotUrl: videoUrl, lastFrameUrl: lastFrameCacheUrl || lastFrameUrl || null });
      } catch (err) {
        setNodes((ns) => ns.map((n) => (n.id === takeId ? { ...n, data: { ...n.data, loading: false, error: err.message, label: 'Take failed' } } : n)));
        Message.error(`Shot failed: ${err.message}`);
      }
    })();
  }, [apiKey, shotFromCard, onPatchCut, setNodes, ensureRefsRegistered, registerShotRefs, resolveCardMediaRefs, durableVideoUrl]);
  handleShootCutRef.current = handleShootCut;


  // 🎬 Action — PRINT THE FILM: every un-shot card renders in parallel. Continuity is
  // carried by the cards' anchors (image space), never by take-to-take handoffs; a
  // failed segment re-prints alone. No auto-stitch (you assemble when it reads right —
  // ▶ / Stitch).
  const handleAction = useCallback(async () => {
    // PRINT THE FILM: every un-shot card renders AT ONCE. Continuity is the cards'
    // keyframes (designed boundaries) — no take feeds any other, a failure re-prints
    // alone, order lives in the cut numbers and sequence bonds.
    const cards = nodesRef.current.filter((n) => n.type === 'cut').sort((a, b) => (a.data?.cut ?? 0) - (b.data?.cut ?? 0));
    if (!cards.length) { Message.warning('No SHOT cards on the board — break the story into shots first.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const oldStepIds = new Set(cards.map((c) => c.data?.lastAnimStepId).filter(Boolean));
    if (oldStepIds.size) updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !oldStepIds.has(e.stepId)) }));
    const kept = cards.filter((c) => c.data?.shotUrl).length;
    traceRef.current.startRun({ note: `Action · print ${cards.length - kept} shots in parallel${kept ? ` (${kept} kept)` : ''}` });
    setTimelineCollapsed(false);
    setAutoFillBusy(true);
    cutShootActiveRef.current = true; // dock-only: suppress the loose session→board copy
    const transport = createBrowserTransport((apiKey || '').trim());
    const lastFrameOf = async (url) => { try { return (await transport.lastFrame(durableVideoUrl(url))).url || null; } catch { return null; } };
    // One card's shoot, shared by both walks below. Returns { ok, lastFrameUrl }.
    const shootCardInAction = async (card) => {
      // Register any photoreal cast plate refs as trusted assets (dodges the real-person filter).
      await ensureRefsRegistered(card);
      const { audioRefUrls, videoRefUrls, videoRefAssetIds } = await resolveCardMediaRefs(card);
      const shot = shotFromCard({ ...card, data: { ...card.data } }, { keepTake: false, audioRefUrls, videoRefUrls, videoRefAssetIds });
      shot.refAssetIds = await registerShotRefs(shot.refUrls, shot.refAssetIds); // continuity frame + non-bible refs → trusted assets
      onPatchCut(card.id, { status: 'running', shotUrl: '' });
      const session = buildSession([], null, { shots: [shot] }, { stitch: false });
      let shotUrl = null;
      let nativeLast = null;
      try {
        const plan = await session.plan();
        wireCutSession(session, mapCutSteps(plan, [card]));
        const anim = plan.find((s) => s.agent === 'animate');
        if (anim) onPatchCut(card.id, { lastAnimStepId: anim.id });
        await session.runAll();
        const animStep = (session.state.plan || []).find((s) => s.agent === 'animate');
        const out = animStep && ((animStep.outputs || []).find((o) => o.id === animStep.pickedId) || (animStep.outputs || [])[0]);
        shotUrl = out?.url || null;
        nativeLast = out?.lastFrameUrl || null; // the return_last_frame PNG (a URL — no TOS staging)
        if (anim) { const slot = card.data.cut ?? 0; updateTimeline((cur) => ({ ...cur, events: (cur.events || []).map((e) => (e.stepId === anim.id ? { ...e, order: slot } : e)) })); }
      } catch (err) { Message.error(`Shot ${(card.data.cut ?? 0) + 1}: ${err.message}`); }
      if (shotUrl) {
        // Native last frame preferred; ffmpeg extraction only if the model didn't return one.
        const lastFrameUrl = nativeLast || (await lastFrameOf(shotUrl)) || null;
        onPatchCut(card.id, { status: 'shot', shotUrl, lastFrameUrl, shotAt: Date.now() });
        upsertShotNodeForCard(card.id, shotUrl);
        return { ok: true, lastFrameUrl };
      }
      onPatchCut(card.id, { status: 'failed' });
      return { ok: false, lastFrameUrl: null };
    };
    let failures = 0;
    try {
      const pending = cards.filter((c) => !c.data?.shotUrl);
      if (!pending.length) { Message.info('Every card already has its take — re-shoot individual cards from their 🎬.'); return; }
      const results = await Promise.all(pending.map((card) => shootCardInAction(card).catch(() => ({ ok: false }))));
      failures = results.filter((r) => !r.ok).length;
      Message.success(`Printed ${pending.length - failures}/${pending.length} shots in parallel${failures ? ` (${failures} failed — re-shoot those, the anchors are unchanged)` : ''}. Press ▶ / Stitch to assemble the cut.`);
    } finally {
      setAutoFillBusy(false);
      cutShootActiveRef.current = false;
    }
  }, [apiKey, buildSession, shotFromCard, wireCutSession, onPatchCut, updateTimeline, upsertShotNodeForCard, ensureRefsRegistered, registerShotRefs, resolveCardMediaRefs, durableVideoUrl]);

  // In-flight guard for split/develop by node id — the data flags drive the spinners,
  // but a setState flag can't stop a same-frame double-click (it commits AFTER the
  // second click); this ref can. laySeqRef keeps two same-millisecond lays from
  // colliding on the id prefix (which would silently merge card sets).
  const splitFlightRef = useRef(new Set());
  const laySeqRef = useRef(0);

  // Lay one SHOT card per split segment, tiled 3-wide next to the anchor node (a Brief
  // or the card being split). Cut numbers: `startCut` when the caller renumbers around
  // a replaced card, else max(existing cut)+1 — Action shoots cards in cut order, so a
  // split lands already sequenced. Returns { idPrefix } (null when nothing laid).
  const layShotSegments = useCallback((segments, anchorNode, { startCut } = {}) => {
    if (!storyboardPanelRef.current || !segments.length) return null;
    const w = Math.round(anchorNode?.measured?.width || anchorNode?.width || 560);
    const pref = anchorNode
      ? { x: (anchorNode.position?.x || 0) + w + 60, y: anchorNode.position?.y || 0 }
      : (rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 220 }) : { x: 220, y: 220 });
    const cols = Math.min(3, segments.length);
    const rows = Math.ceil(segments.length / cols);
    const base = freeOrigin({ w: cols * CUT_COL_W, h: rows * CUT_ROW_H, preferred: pref });
    const cutBase = startCut ?? (nodesRef.current
      .filter((n) => n.type === 'cut')
      .reduce((m, n) => Math.max(m, Number.isFinite(n.data?.cut) ? n.data.cut : -1), -1) + 1);
    const idPrefix = `film-${Date.now().toString(36)}${(laySeqRef.current += 1).toString(36)}`;
    segments.forEach((s, i) => {
      storyboardPanelRef.current({
        index: i, cut: cutBase + i, idPrefix, title: s.beat,
        action: s.text, promptOverride: s.text, framing: '',
        shotTemplate: 'medium-shot', durationSec: s.durationSec,
        refEntryIds: [], audio: '',
      }, base);
    });
    return { idPrefix };
  }, [rfInstance, freeOrigin]);

  // ✂ on a SHOT card: the same segmentation (splitIntoShots — wording + timestamps
  // preserved) on the card's prompt. The SOURCE CARD STAYS — Split ADDS, never
  // replaces; the original wording, refs, takes and grid remain untouched;
  // the segment cards slot in right AFTER it (later cards shift by len to make room).
  // Delete the original yourself if the pieces supersede it. Explicit tap only.
  const splitCardToShots = useCallback(async (id) => {
    if (splitFlightRef.current.has(id)) return;
    const card = nodesRef.current.find((n) => n.id === id && n.type === 'cut');
    if (!card || card.data?.splitting || card.data?.developing) return;
    const text = String(card.data?.promptOverride || card.data?.beat || '').trim();
    if (!text) { Message.warning('Write the shot prompt first — Split needs content to divide.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    splitFlightRef.current.add(id);
    onPatchCut(id, { splitting: true });
    traceRef.current.startRun({ note: 'Agent · Split shot' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { segments } = await splitIntoShots({ text }, ctx);
      if (segments.length < 2) { Message.info('This shot already fits one take — nothing to split.'); return; }
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Split shot · ${segments.length} pieces (${segments.map((s) => s.durationSec).join('+')}s)` });
      // Re-read the card: it may have been dragged while the LLM ran.
      const fresh = nodesRef.current.find((n) => n.id === id) || card;
      const origCut = fresh.data?.cut ?? 0;
      const laid = layShotSegments(segments, fresh, { startCut: origCut + 1 });
      if (!laid) return; // nothing laid → nothing changes
      // Source card, grid and takes stay exactly as they are — only make room in the
      // film order: every later card shifts by len so the segments follow the original.
      setNodes((ns) => ns.map((n) => (
        n.type === 'cut' && n.id !== id && !String(n.id).startsWith(laid.idPrefix) && (n.data?.cut ?? 0) > origCut
          ? { ...n, data: { ...n.data, cut: (n.data.cut ?? 0) + segments.length } }
          : n)));
      Message.success(`Shot split into ${segments.length} cards after the original — the original card and its takes stay; delete it if the pieces supersede it.`);
    } catch (e) { Message.error(`Split failed: ${e.message}`); }
    finally { splitFlightRef.current.delete(id); onPatchCut(id, { splitting: false }); }
  }, [apiKey, onPatchCut, layShotSegments, setNodes]);

  // Develop on a SHOT card (opt-in, the Brief's Develop at shot grain): rewrite the
  // card's prompt into one cinematic Seedance prompt at LIGHT depth ('preserve' keeps
  // every stated event). Source rule: a HAND-EDITED prompt (differs from the last
  // develop output) becomes the new source; otherwise re-develops re-run from the
  // stashed original segment — never a rewrite of a rewrite, and manual edits are
  // never silently ignored. Explicit tap only; nothing runs under the hood.
  // COMPOSE — the card's ONE prompt-writing button, keyframe-aware: a visible call
  // that reads the card's keyframes (ordered),
  // its enabled reference chips and the existing text, and writes the cinematic ACTION
  // for the SELECTED video model per the best-practice guide. The text's wording +
  // dialogue ride verbatim as the material; the compiler keeps owning binding lines.
  const composeCutPrompt = useCallback(async (id) => {
    if (splitFlightRef.current.has(`dev-${id}`)) return;
    const card = nodesRef.current.find((n) => n.id === id && n.type === 'cut');
    if (!card || card.data?.developing || card.data?.splitting) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const baseRefs = shotReferences(card.data, bibleRef.current);
    const kfPairs = cardKfPairs(card.data, baseRefs);
    const kfIndices = kfPairs.map((x) => x.idx);
    const text = String(card.data?.promptOverride || card.data?.beat || '').trim();
    if (!text && !baseRefs.length) { Message.warning('Compose needs something to work from — write the prompt, or attach references / keyframes.'); return; }
    const roster = [
      ...baseRefs.map((r, i) => `[Image ${i + 1}] = ${r.name || r.desc || 'reference'}${r.role ? ` (${r.role})` : ''}${kfIndices.includes(i + 1) ? ` — KEYFRAME ${kfIndices.indexOf(i + 1) + 1}` : ''}`),
      ...(card.data.audioRefs || []).map((a, i) => `Audio ${i + 1} = ${a.label || 'audio clip'}${a.role ? ` (${a.role})` : ''}`),
      ...(card.data.videoRefs || []).map((v, i) => `Video ${i + 1} = ${v.label || 'video'}${v.role ? ` (${v.role})` : ''}`),
    ];
    const modelKey = videoModelKeyOf(card.data?.videoModel);
    splitFlightRef.current.add(`dev-${id}`);
    onPatchCut(id, { developing: true });
    traceRef.current.startRun({ note: kfIndices.length
      ? `Agent · Shot compose (derive from ${kfIndices.length} keyframe${kfIndices.length === 1 ? '' : 's'} → enrich with ${baseRefs.length} ref${baseRefs.length === 1 ? '' : 's'} · 2 calls)`
      : `Agent · Shot compose (${baseRefs.length} ref${baseRefs.length === 1 ? '' : 's'} · 1 call)` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await composeShotAction({
        text, references: baseRefs.map((r) => r.url), roster, kfIndices, modelKey,
        durationSec: Math.max(4, Math.round(Number(card.data?.durationSec) || 10)),
      }, ctx);
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Shot compose · ${out.action.length}-char action${out.derived ? ` (derived ${out.derived.length} chars from keyframes)` : ''}` });
      onPatchCut(id, {
        promptOverride: out.action,
        developSource: card.data?.developSource || text, // the original words survive, stashed once
        composeDropped: out.dropped || [], // text events the keyframes overrode — reported, never silent
        ...(out.audio && !String(card.data?.audio || '').trim() ? { audio: out.audio } : {}),
      });
      if (out.dropped?.length) Message.warning(`Composed from the keyframes — overrode from your text: ${out.dropped.join(' · ')} (stashed in developSource if you want it back).`);
      else Message.success(kfIndices.length
        ? `Composed FROM ${kfIndices.length} keyframe${kfIndices.length === 1 ? '' : 's'} — the action walks K1 → K${kfIndices.length}; dialogue carried verbatim.`
        : 'Composed against the references — wording carried.');
    } catch (e) { Message.error(`Compose failed: ${e.message}`); }
    finally { splitFlightRef.current.delete(`dev-${id}`); onPatchCut(id, { developing: false }); }
  }, [apiKey, onPatchCut]);

  // DIRECT — apply one director's note to the card's prompt: the note shapes how the
  // shot feels/reads; events, [Image N] tags, dialogue, refs and keyframes all stay.
  const directCutPrompt = useCallback(async (id, note = '') => {
    if (splitFlightRef.current.has(`dev-${id}`)) return;
    const card = nodesRef.current.find((n) => n.id === id && n.type === 'cut');
    if (!card || card.data?.developing || card.data?.splitting) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const text = String(card.data?.promptOverride || card.data?.beat || '').trim();
    if (!text) { Message.warning('Direct re-shapes the existing prompt — write it, or Compose first.'); return; }
    const baseRefs = shotReferences(card.data, bibleRef.current);
    const kfPairs = cardKfPairs(card.data, baseRefs);
    const kfIndices = kfPairs.map((x) => x.idx);
    const roster = [
      ...baseRefs.map((r, i) => `[Image ${i + 1}] = ${r.name || r.desc || 'reference'}${r.role ? ` (${r.role})` : ''}${kfIndices.includes(i + 1) ? ` — KEYFRAME ${kfIndices.indexOf(i + 1) + 1}` : ''}`),
      ...(card.data.audioRefs || []).map((a, i) => `Audio ${i + 1} = ${a.label || 'audio clip'}${a.role ? ` (${a.role})` : ''}`),
      ...(card.data.videoRefs || []).map((v, i) => `Video ${i + 1} = ${v.label || 'video'}${v.role ? ` (${v.role})` : ''}`),
    ];
    splitFlightRef.current.add(`dev-${id}`);
    onPatchCut(id, { developing: true });
    traceRef.current.startRun({ note: 'Agent · Shot direct (note · 1 call)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await directShotAction({
        text, note, references: baseRefs.map((r) => r.url), roster, kfIndices,
        modelKey: videoModelKeyOf(card.data?.videoModel),
        durationSec: Math.max(4, Math.round(Number(card.data?.durationSec) || 10)),
      }, ctx);
      onPatchCut(id, {
        promptOverride: out.action,
        developSource: card.data?.developSource || text,
        ...(out.audio ? { audio: out.audio } : {}),
      });
      Message.success('Note applied — the shot reads as directed; references, dialogue and keyframes untouched.');
    } catch (e) { Message.error(`Direct failed: ${e.message}`); }
    finally { splitFlightRef.current.delete(`dev-${id}`); onPatchCut(id, { developing: false }); }
  }, [apiKey, onPatchCut]);

  // ENRICH the card's CURRENT prompt in place — the expansion twin of Compose: the
  // text is the skeleton (events, [Image N] tags, dialogue verbatim), the call adds
  // camera/motion/texture/atmosphere/VFX/sound density around it. References and
  // keyframes are read, never written.
  const enrichCutPrompt = useCallback(async (id, level = 'rich') => {
    if (splitFlightRef.current.has(`dev-${id}`)) return;
    const card = nodesRef.current.find((n) => n.id === id && n.type === 'cut');
    if (!card || card.data?.developing || card.data?.splitting) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const text = String(card.data?.promptOverride || card.data?.beat || '').trim();
    if (!text) { Message.warning('Enrich expands the existing prompt — write it, or Compose first.'); return; }
    const baseRefs = shotReferences(card.data, bibleRef.current);
    const kfPairs = cardKfPairs(card.data, baseRefs);
    const kfIndices = kfPairs.map((x) => x.idx);
    const roster = [
      ...baseRefs.map((r, i) => `[Image ${i + 1}] = ${r.name || r.desc || 'reference'}${r.role ? ` (${r.role})` : ''}${kfIndices.includes(i + 1) ? ` — KEYFRAME ${kfIndices.indexOf(i + 1) + 1}` : ''}`),
      ...(card.data.audioRefs || []).map((a, i) => `Audio ${i + 1} = ${a.label || 'audio clip'}${a.role ? ` (${a.role})` : ''}`),
      ...(card.data.videoRefs || []).map((v, i) => `Video ${i + 1} = ${v.label || 'video'}${v.role ? ` (${v.role})` : ''}`),
    ];
    const modelKey = videoModelKeyOf(card.data?.videoModel);
    splitFlightRef.current.add(`dev-${id}`);
    onPatchCut(id, { developing: true });
    traceRef.current.startRun({ note: `Agent · Shot enrich (${level} · ${baseRefs.length} ref${baseRefs.length === 1 ? '' : 's'} · 1 call)` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await enrichShotAction({
        text, references: baseRefs.map((r) => r.url), roster, kfIndices, modelKey, level,
        durationSec: Math.max(4, Math.round(Number(card.data?.durationSec) || 10)),
      }, ctx);
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Shot enrich · ${text.length} → ${out.action.length} chars` });
      onPatchCut(id, {
        promptOverride: out.action,
        developSource: card.data?.developSource || text,
        ...(out.audio && !String(card.data?.audio || '').trim() ? { audio: out.audio } : {}),
      });
      Message.success(`Enriched — ${out.action.split(/\s+/).length} words; events, [Image N] tags and dialogue carried.`);
    } catch (e) { Message.error(`Enrich failed: ${e.message}`); }
    finally { splitFlightRef.current.delete(`dev-${id}`); onPatchCut(id, { developing: false }); }
  }, [apiKey, onPatchCut]);

  // PROMOTE an approved storyboard keyframe to a production SHOT card — the boards →
  // shot-list handoff. The card carries the shot's beat/camera/duration, the keyframe
  // becomes its START ANCHOR (the pinned grammar's composition binding — no lock
  // text), and the shot's body follows as the editable starting text (a still's
  // language — add motion + dialogue, then 🎬).
  const promoteKeyframeToCard = useCallback((nodeId) => {
    const kf = nodesRef.current.find((n) => n.id === nodeId);
    const url = kf && refUrl(kf);
    if (!kf?.data?.keyframe || !url) { Message.warning('The keyframe is still rendering — promote it once the still lands.'); return; }
    if (!storyboardPanelRef.current) return;
    const chatId = kf.data.panelId ? String(kf.data.panelId).replace('sbpanel', 'sbchat') : null;
    const chat = chatId ? nodesRef.current.find((n) => n.id === chatId) : null;
    // The row's data IS the shot (kfCardData mirrors the list) — chat list wins when present.
    const sShot = (chat?.data?.shots || [])[kf.data.index] || kf.data;
    const pool = (chat?.data?.refs || chat?.data?.pool || []).map(poolRef);
    const panel = kf.data.panelId ? nodesRef.current.find((n) => n.id === kf.data.panelId) : null;
    const pref = panel
      ? { x: (panel.position?.x || 0) + (Number(panel.style?.width) || 780) + 60, y: (panel.position?.y || 0) }
      : { x: ((chat || kf).position?.x || 0) + 840, y: (chat || kf).position?.y || 0 };
    const base = freeOrigin({ w: CUT_COL_W, h: CUT_ROW_H, preferred: pref });
    const cut = nodesRef.current.filter((n) => n.type === 'cut').reduce((m, n) => Math.max(m, Number.isFinite(n.data?.cut) ? n.data.cut : -1), -1) + 1;
    const cardId = layAnchoredCard(kf, sShot, pool, cut, base);
    if (!cardId) return;
    const hasEnd = !!kf.data.endStill?.url;
    Message.success(`SHOT ${cut + 1} laid from “${String(kf.data.beat || 'keyframe').slice(0, 24)}” — refs attached, K1${hasEnd ? ' + K2' : ''} pinned; 🎬 when ready.`);
  }, [freeOrigin, layAnchoredCard]);

  // CANON media references — audio/video nodes the user tagged (★ Reference): every SHOT
  // card offers them as one-tap attach chips in its REFERENCES row (the media analog of
  // bible entries, kept OUT of the image bible whose roles/consumers assume pixels).
  const mediaEntries = useMemo(() => nodes
    .filter((n) => (n.data?.kind === 'audio' || n.data?.kind === 'video') && n.data?.mediaRef && (n.data?.cacheUrl || n.data?.url))
    .map((n) => ({ nodeId: n.id, kind: n.data.kind, url: n.data.cacheUrl || n.data.url, label: n.data.label || n.data.kind, duration: Number(n.data.duration) || null })), [nodes]);

  // The card context: patching, shooting, attaching, splitting and developing.
  // Last-frame handoffs are always EXPLICIT: when a card has an
  // incoming sequence bond whose source already has a take, its START picker offers
  // that take's last frame FIRST — one visible tap instead of a hidden handoff.
  const prevTakeFrames = useMemo(() => {
    const map = {};
    edges.filter((e) => e.type === 'continuity').forEach((e) => {
      const src = nodes.find((n) => n.id === e.source && n.type === 'cut');
      if (src?.data?.lastFrameUrl) map[e.target] = { nodeId: null, url: src.data.lastFrameUrl, assetId: null, label: `◀ prev take last frame (${(src.data.beat || 'shot').slice(0, 18)})` };
    });
    return map;
  }, [nodes, edges]);

  // Every board image the anchor picker can offer (newest first) — the anchor slots
  // on a SHOT card ground its opening/closing composition in ANY board still.
  const boardImages = useMemo(() => nodes
    .filter((n) => n.data?.kind === 'image' && (n.data.url || n.data.cacheUrl) && !n.hidden)
    .map((n) => ({ nodeId: n.id, url: n.data.cacheUrl || n.data.url, assetId: n.data.assetId || null, label: n.data.label || n.data.beat || 'image', createdAt: n.data.createdAt || 0 }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 80), [nodes]);

  // The card's compiled-prompt preview (full-prompt-preview rule): EXACTLY what the
  // 🎬 shoot would send, anchors and all — pure read, no side effects, no spend.
  const previewCutPrompt = useCallback((cardId) => {
    const c = nodesRef.current.find((n) => n.id === cardId && n.type === 'cut');
    try { return c ? shotFromCard(c).motion : ''; } catch { return ''; }
  }, [shotFromCard]);

  const cutCtx = useMemo(() => ({
    onPatchCut,
    bibleEntries,
    mediaEntries,
    onShootCut: handleShootCut,
    onAttachAsset: attachRefToCut,
    onSplitCut: splitCardToShots,
    onComposeCut: composeCutPrompt,
    onEnrichCut: enrichCutPrompt,
    onDirectCut: directCutPrompt,
    onOpenTakes: openTakesForCard,
    boardImages,
    prevTakeFrames,
    onCompilePreview: previewCutPrompt,
    onOpenRefDrawer: openRefDrawer,
  }), [onPatchCut, bibleEntries, mediaEntries, handleShootCut, attachRefToCut, splitCardToShots, composeCutPrompt, enrichCutPrompt, directCutPrompt, openTakesForCard, boardImages, prevTakeFrames, previewCutPrompt, openRefDrawer]);

  const filmMode = true; // Short-Film-only suite.

  // ---- Story agent: an idea/script → one long cinematic prompt → New Shot -----------
  // Each Story is an INDEPENDENT node — its whole state ({ idea, mode, prompt, complexity,
  // busy, shooting, phase }) lives in that node's data, so the board can hold many at once.
  // Patch one by id (transient flags are stripped from persistence).
  const patchStoryNode = useCallback((id, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === id && n.type === 'story')
      ? { ...n, data: { ...n.data, ...(typeof patch === 'function' ? patch(n.data || {}) : patch) } }
      : n));
  }, [setNodes]);

  // Live narration channel: the chat surfaces these (cast draft, routing, pipeline).
  const filmSeqRef = useRef(0);
  const [filmProgress, setFilmProgress] = useState(null); // { seq, text } → FilmDock prints
  const pushFilmNote = useCallback((text) => {
    filmSeqRef.current += 1;
    setFilmProgress({ seq: filmSeqRef.current, text });
  }, []);

  // Start Short Film mode (the launcher card): lock the recipe and open the
  // conversational director — the chat IS film mode's front door.
  const [filmDockOpen, setFilmDockOpen] = useState(false);
  // Just the chat — no timeline expansion, no agent panel: the director dock is
  // film mode's only opening surface (the timeline grows on its own when takes land).
  const startShortFilm = useCallback(() => {
    onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current
      ? { ...prev, recipe: { ...(prev.recipe || {}), id: SHORT_FILM_RECIPE.id } }
      : prev));
    setFilmDockOpen(true);
  }, [onUpdateProject]);

  // The pipeline read FRESH from refs — used by routing context and the
  // deterministic "continue" ladder, so neither can drift from the board.
  const livePipeline = useCallback(() => {
    // Brief ✓ = a Brief node with VERBATIM text — the developed prompt is opt-in now, so
    // the Story/Brief stage must never wait on it.
    const brief = nodesRef.current.find((n) => n.type === 'story' && String(n.data?.idea || '').trim())?.data?.idea || '';
    return pipelineStatus({
      idea: brief,
      storyPrompt: brief,
      bibleEntries: bibleRef.current,
      cutCards: nodesRef.current.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
      filmUrl: projectRef.current?.timeline?.film?.url || '',
      candidates: nodesRef.current.filter((n) => n.data?.kind === 'image' && !n.data?.bibleRole).length,
    });
  }, []);

  // Route one chat message → ONE studio action (LLM interprets, traced; the user
  // confirms in the dock; dispatch below is deterministic).
  const routeFilmMessage = useCallback(async (message) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return null; }
    const roles = BIBLE_ROLES.map((r) => { const n = bibleRef.current.filter((b) => b.role === r).length; return n ? `${r}×${n}` : null; }).filter(Boolean).join(' ');
    // The pipeline state rides in the routing context, so even free-form answers
    // are grounded in where the project ACTUALLY stands.
    const pipe = livePipeline().map((s) => `${s.label}: ${s.status === 'done' ? 'done' : s.note}`).join(' · ');
    const context = `pipeline — ${pipe} · idea: ${nodesRef.current.some((n) => n.type === 'story' && n.data?.idea) ? 'set' : 'NOT set'} · genre: ${projectRef.current?.genre?.line ? `locked (${projectRef.current.genre.line})` : 'NOT set'} · bible: ${roles || '(empty)'} · board selection: ${nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image').length} image(s)`;
    // Every chat message is a small workflow of its own, so the route read (and an
    // answer-mode reply) never orphan into "Other actions" in the History export.
    traceRef.current.startRun({ note: `Chat · “${message.replace(/\s+/g, ' ').trim().slice(0, 60)}”` });
    const rec = traceRef.current.log({ kind: 'route', prompt: message.slice(0, 160), status: 'running' });
    try {
      const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
      const routed = await routeStudioAction({ message, context }, ctx);
      rec.status = 'ok'; rec.result = routed ? routed.action : 'no read';
      return routed;
    } catch (err) {
      rec.status = 'error'; rec.error = err.message;
      return null;
    }
  }, [apiKey, livePipeline]);

  // The image node behind a bible role (the cast/world anchors as chat targets).
  const nodesForRole = useCallback((role) => bibleRef.current
    .filter((b) => b.role === role && b.nodeId)
    .map((b) => nodesRef.current.find((n) => n.id === b.nodeId && n.data?.kind === 'image'))
    .filter(Boolean), []);


  // ---- Brief (your idea/script, kept VERBATIM → Cast & World / Storyboard / New Shot) ----
  const storyClient = useCallback(() => ({ client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) }), [apiKey]);

  // A Brief lives ON THE BOARD as a node — a container for the user's OWN words (an idea,
  // a description or a full script), landed INSTANTLY with no LLM call; it reads its own
  // state from node.data. createStoryNode ALWAYS lays a fresh one (the rail/chat spawn a
  // new Brief each time) and returns its id.
  const createStoryNode = useCallback(({ idea = '' } = {}) => {
    const id = `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setNodes((ns) => {
      const preferred = rfInstance ? rfInstance.screenToFlowPosition({ x: 260, y: 200 }) : { x: 160, y: 160 };
      const position = freeOrigin({ w: 1000, h: 420, preferred }); // wide node — beats laid left-to-right
      return ns.concat({ id, type: 'story', position, data: { idea, mode: '', prompt: '', complexity: 'medium', busy: false, shooting: false, casting: false, phase: 'idle' } });
    });
    return id;
  }, [setNodes, rfInstance, freeOrigin]);

  const removeStoryNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, [setNodes]);

  // DEVELOP (opt-in): rewrite this node's verbatim brief into ONE long cinematic prompt at
  // the chosen depth (light | medium | deep — the node's toggle). Only New Shot consumes
  // the rewrite (Seedance wants a single dense prompt); Cast & World and Storyboard read
  // the brief verbatim. A long or multi-line brief reads as a SCRIPT (events preserved),
  // a short one as an IDEA (expanded). node.data persists with the board across reloads.
  // RETURNS the developed prompt ('' on failure) — callers that need it right away
  // (New Shot's lazy develop) must use the return value: nodesRef only syncs in a
  // passive effect AFTER the commit that follows patchStoryNode, so re-reading the
  // node immediately after awaiting this would still see the pre-develop data.
  const runStory = useCallback(async ({ id }) => {
    const data = nodesRef.current.find((n) => n.id === id)?.data || {};
    const text = String(data.idea || '').trim();
    if (!text) { Message.warning('Write the brief first — an idea, a description or a script.'); return ''; }
    const complexity = data.complexity || 'medium';
    const asScript = text.length >= 400 || text.split(/\n/).length >= 4;
    traceRef.current.startRun({ note: 'Agent · Brief · develop' });
    patchStoryNode(id, { busy: true, phase: 'writing' });
    try {
      const { mode, prompt } = await writeFilmPrompt({ idea: asScript ? '' : text, source: asScript ? text : '', complexity }, storyClient());
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Brief · developed ${prompt.length}-char prompt (${mode}, ${complexity})` });
      patchStoryNode(id, { mode, prompt, busy: false, phase: 'ready' });
      return prompt;
    } catch (e) { Message.error(`Develop failed: ${e.message}`); patchStoryNode(id, (d) => ({ busy: false, phase: d.prompt ? 'ready' : 'idle' })); return ''; }
  }, [storyClient, patchStoryNode]);

  // The node's Develop button (a re-develop overwrites the previous cinematic prompt).
  const developStory = useCallback((id) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    if (d.busy || d.shooting) return;
    runStory({ id });
  }, [runStory]);

  // Manual edits — the brief body (verbatim; what Cast & World and Storyboard consume) and
  // the developed cinematic prompt (what New Shot puts on the card).
  const editStoryIdea = useCallback((id, text) => patchStoryNode(id, { idea: text }), [patchStoryNode]);
  const editStoryPrompt = useCallback((id, text) => patchStoryNode(id, { prompt: text }), [patchStoryNode]);

  // Split size (the "Shots" field next to Split): a GOAL for splitIntoShots, null = auto
  // (fewest possible). Persists with the node like any other setting.
  const setStorySplitCount = useCallback((id, v) => {
    const n = Math.round(Number(v));
    patchStoryNode(id, { splitCount: Number.isFinite(n) && n >= 2 ? Math.min(24, n) : null });
  }, [patchStoryNode]);

  // Rewrite DEPTH (light | medium | deep) — the next Rewrite of this node uses it.
  const setStoryComplexity = useCallback((id, complexity) => patchStoryNode(id, { complexity }), [patchStoryNode]);

  // Cast & World from this Brief node → draft the characters/locations/look from its
  // VERBATIM brief (the same castDraft path as the rail/chat; plates land tagged on the
  // board). The node's button spins via a transient `casting` flag while the draft runs.
  const draftCastFromStory = useCallback(async (id) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    const idea = (d.idea || d.prompt || '').trim();
    if (!idea) { Message.warning('Write the brief first — Cast & World needs a premise.'); return; }
    if (!castRunRef.current) return;
    patchStoryNode(id, { casting: true });
    try { await castRunRef.current(idea); }
    catch (err) { Message.error(err.message); } // the placeholder panel is gone by now — the toast is the only trace
    finally { patchStoryNode(id, { casting: false }); }
  }, [patchStoryNode]);

  // Storyboard from this Brief node → the shot-division chat + keyframe panel, fed the
  // node's VERBATIM brief (never the developed prompt — the division re-reads YOUR words,
  // so there is exactly ONE reinterpretation between you and the keyframes). NO gate:
  // it always runs, reference-free when no cast exists. A transient `boarding` flag
  // debounces the button (a double-click would spawn two boards).
  const storyboardFromStory = useCallback((id) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    const text = String(d.idea || '').trim();
    if (!text) { Message.warning('Write the brief first — Storyboard needs your description or script.'); return; }
    // PANEL-FIRST, matching the rail: the button opens the Storyboard agent's
    // configuration panel bound to THIS Brief — pace, output mode,
    // Lite/Pro, style, refs — and the panel's primary spawns the chat. Nothing runs
    // on this click; the selected Brief is the panel's script source (verbatim).
    setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)));
    setPanelAgentId('storyboard');
  }, [setNodes]);

  // Split into Shots — the AD's shot breakdown: ONE LLM call (splitIntoShots) segments
  // this Brief's VERBATIM text into sequential model-capped pieces — wording, details and
  // timestamps PRESERVED, never summarized — and each piece lands as a SHOT card tiled
  // right of the Brief, cut-numbered in order. From there the existing machinery takes
  // over: per-card 🎬, or Action shoots the cards continuity-chained. Explicit tap only.
  const splitBriefToShots = useCallback(async (id) => {
    if (splitFlightRef.current.has(id)) return;
    const node = nodesRef.current.find((n) => n.id === id && n.type === 'story');
    if (!node || node.data?.splitting) return;
    const text = String(node.data?.idea || '').trim();
    if (!text) { Message.warning('Write the brief first — Split needs your description or script.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    splitFlightRef.current.add(id);
    patchStoryNode(id, { splitting: true });
    traceRef.current.startRun({ note: 'Agent · Split into shots' });
    try {
      const { segments } = await splitIntoShots({ text, count: node.data?.splitCount || undefined }, storyClient());
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Split · ${segments.length} shots (${segments.map((s) => s.durationSec).join('+')}s)` });
      layShotSegments(segments, nodesRef.current.find((n) => n.id === id) || node);
      Message.success(`${segments.length} SHOT card${segments.length === 1 ? '' : 's'} on the board — attach refs, then 🎬 per card or Action for the chained sequence.`);
    } catch (e) { Message.error(`Split failed: ${e.message}`); }
    finally { splitFlightRef.current.delete(id); patchStoryNode(id, { splitting: false }); }
  }, [apiKey, storyClient, patchStoryNode, layShotSegments]);

  // New Shot → lay an editable SHOT card (CutNode) carrying this Brief VERBATIM — the
  // developed cinematic prompt when the user explicitly made one (the node labels that
  // section "what New Shot shoots"), else the brief text itself. NO hidden develop:
  // New Shot NEVER rewrites the user's words under the hood (the consistency rule) —
  // Develop is a button, not a side effect. The user edits the prompt / camera / SD
  // params on the card, then 🎬 on the card shoots it.
  const shootFilm = useCallback((id) => {
    const storyNode = nodesRef.current.find((n) => n.id === id && n.type === 'story');
    const prompt = String(storyNode?.data?.prompt || storyNode?.data?.idea || '').trim();
    if (!prompt) { Message.warning('Write the brief first — an idea, a description or a script.'); return; }
    if (!storyboardPanelRef.current) return;
    // Land the SHOT card NEXT TO this Brief node (to its right); fall back to a screen spot.
    const storyW = Math.round(storyNode?.measured?.width || storyNode?.width || 560);
    const pref = storyNode
      ? { x: (storyNode.position?.x || 0) + storyW + 60, y: storyNode.position?.y || 0 }
      : (rfInstance ? rfInstance.screenToFlowPosition({ x: 280, y: 480 }) : { x: 180, y: 480 });
    const base = freeOrigin({ w: CUT_COL_W, h: CUT_ROW_H, preferred: pref });
    // A UNIQUE prefix per click → New Shot ALWAYS lays a fresh card (never re-derives an
    // existing one); freeOrigin tiles each near the Story so they don't overlap. `cut`
    // numbers the SHOT label by how many already exist (index 0 keeps the card AT `base`).
    const cut = nodesRef.current.filter((n) => n.type === 'cut' && String(n.id).startsWith('film-')).length;
    storyboardPanelRef.current({
      index: 0, cut, idPrefix: `film-${Date.now().toString(36)}`, title: (storyNode?.data?.idea || 'Film').slice(0, 40),
      action: prompt, promptOverride: prompt, framing: '', shotTemplate: 'medium-shot', durationSec: maxShotSeconds(defaultVideoModelKey()),
      refEntryIds: [], audio: '',
    }, base);
    Message.success('SHOT card on the board — edit the prompt, camera and SD params, then 🎬 to shoot.');
  }, [rfInstance, freeOrigin]);

  // ---- Storyboard = SHOT DIVISION → a STRIP BOARD of rows ---------------------------
  // A control card bound to ONE STRIP NODE (sbstrip): the whole shot list as a strict
  // 3-column table [text | START | END] with internal vertical scroll. Per-shot keyframe
  // nodes are PERMANENTLY HIDDEN data nodes (the takes pattern) — renders/editor/promote
  // address them by id; the strip is their only display surface. Surgery = strip buttons
  // (↑ ↓ ✕) plus the constrained action bar
  // (Note→re-author / Add / Cut / Re-divide). The only reasoner calls in the loop
  // are carve + author.
  const SB_PANEL_H = GROUP_HEADER + GROUP_PAD * 2 + PLATE_ROW_H;   // spawn spacing estimate

  // The shot's fields as CARD DATA (shared by the layout reconciler AND row surgery —
  // one mapping, so a rebuilt row is indistinguishable from a laid one).
  const kfCardData = (s, i, refs, style, imageModel, panelId) => ({
    label: s.beat, beat: s.beat, body: s.body, shotTemplate: s.shotTemplate, expression: s.expression || '',
    figures: s.figures || [], durationSec: s.durationSec || 10, intExt: s.intExt || '',
    figureLabels: (s.figures || []).map((f) => String(refs[f - 1]?.label || `Image ${f}`).slice(0, 16)),
    motion: s.motion || '', exiting: s.exiting || '', audio: s.audio || '',
    span: s.span || '', authorPending: !!s.authorPending, missingDialogue: s.missingDialogue || [], authorError: s.authorError || '',
    style, imageModel, keyframe: true, panelId, index: i,
  });
  // The render-stash keys that must TRAVEL WITH a shot through cut/reorder/insert —
  // the paid pixels and their provenance (never regenerated by surgery).
  const KF_STASH = ['url', 'cacheUrl', 'bodyRendered', 'shotRefs', 'endStill', 'staleStill'];

  // Reconcile the panel to `shots` as TEXT-FIRST CARDS — layout only, ZERO renders.
  // Each shot lands (or updates) in the grid slot its still will occupy: a compact
  // panel card (header line + action text + casting chips + its own Render button).
  // A card that already HAS a still keeps it; if its text changed it's marked
  // staleStill so the tile can say "text changed — re-render to match". Stills are
  // bought per card (Render still) or panel-wide (Render all) — never here.
  const applyShotCards = useCallback((panelId, shots, prevShots, refs = [], { style = '', imageModel = defaultImageModelKey() } = {}) => {
    const base = { x: GROUP_PAD, y: GROUP_HEADER + GROUP_PAD };
    // A shot's RENDER-RELEVANT fields changed → an existing still no longer matches.
    const changed = (i) => { const p = prevShots[i]; const s = shots[i]; return !(p && p.body === s.body && p.shotTemplate === s.shotTemplate && (p.expression || '') === (s.expression || '') && JSON.stringify(p.figures || []) === JSON.stringify(s.figures || [])); };
    const shotData = (s, i) => kfCardData(s, i, refs, style, imageModel, panelId);
    setNodes((ns) => {
      let next = ns;
      // The strip element: its own draggable node, laid below the control card on
      // first divide. A user-deleted strip stays deleted (stripHidden).
      const chatId2 = String(panelId).replace('sbpanel', 'sbchat');
      const chatNode = next.find((n) => n.id === chatId2);
      if (shots.length && !chatNode?.data?.stripHidden && !next.some((n) => n.id === panelId)) {
        const chat = chatNode;
        const pos = chat
          ? { x: chat.position?.x || 0, y: (chat.position?.y || 0) + (chat.measured?.height || 560) + 30 }
          : { x: 120, y: 120 };
        next = next.concat({ id: panelId, type: 'sbstrip', position: pos, data: { chatId: chatId2, layerId: 'storyboard' }, style: { width: 780 } });
      }
      shots.forEach((s, i) => {
        const id = `${panelId}-${i}`;
        const cur = next.find((n) => n.id === id);
        if (cur) {
          const hasStill = !!(cur.data?.url || cur.data?.cacheUrl);
          next = next.map((n) => (n.id === id ? {
            ...n, hidden: true, parentId: undefined,
            data: { ...n.data, ...shotData(s, i), ...(changed(i) && hasStill ? { staleStill: true } : {}), ...(changed(i) ? { error: undefined } : {}) },
          } : n));
        } else {
          const kf = createAssetNode({ kind: 'image', url: '', label: s.beat, position: base, layerId: 'storyboard' });
          next = next.concat({ ...kf, id, hidden: true, data: { ...kf.data, ...shotData(s, i) } });
        }
      });
      return next.filter((n) => n.id !== `${panelId}-sheet` && !(String(n.id).startsWith(`${panelId}-`) && (Number(String(n.id).slice(panelId.length + 1)) || 0) >= shots.length));
    });
  }, [setNodes]);

  // THE division (bound to THIS control node): carve the script into verbatim spans,
  // lay the rows instantly, author each shot in parallel. Runs ONCE; a re-divide comes
  // through the action bar (which clears the list first and passes fresh). `seed`
  // carries { panelId, script } for a just-spawned node not yet in nodesRef.
  const runDivide = useCallback(async (nodeId, seed, { fresh = false } = {}) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node && !seed) return;
    const panelId = node?.data?.panelId || seed?.panelId;
    const script = node?.data?.script || seed?.script || '';
    const prevShots = fresh ? [] : (node?.data?.shots || []);
    if (prevShots.length) { Message.info('Already divided — edit the rows directly, or Re-divide from the action bar.'); return; }
    const shotLength = node?.data?.shotLength || seed?.shotLength || 'auto'; // per-shot pace — count is an OUTPUT of script ÷ pace
    let refs = node?.data?.refs || seed?.refs || []; // optional reference assets (picked on Run)
    const ethnicity = node?.data?.ethnicity || seed?.ethnicity || ''; // consistency lever (whole storyboard)
    const style = node?.data?.style || seed?.style || ''; // aesthetic (Auto → the division decides)
    const imageModel = imageModelKeyOf(node?.data?.imageModel || seed?.imageModel); // Seedream Lite | Pro
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, busy: true, stripHidden: false } } : n)));
    traceRef.current.startRun({ note: 'Agent · Storyboard (shot division)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      // A divide with NO picked references: reuse the bible's characters
      // as the anchor if any exist — the reference-aware division must SEE the references to
      // assign figures per shot. NO fallback generation: Cast & World never launches under
      // the hood (unanchored entry points ASK before spawning); with no anchor at all the
      // division simply runs reference-free.
      if (!refs.length) {
        const bibleChars = (bibleRef.current || []).filter((e) => e.role === 'character' && e.url)
          .map((e) => ({ entryId: e.id, nodeId: e.nodeId || null, url: e.url, label: e.name || 'character' }));
        if (bibleChars.length) {
          refs = bibleChars;
          setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, refs } } : n)));
        }
      }
      // ---- 2-STEP FIRST DIVISION: CARVE structure + verbatim spans, then AUTHOR each
      // shot in parallel (one focused call per shot — kills late-list attention
      // collapse). Cards land instantly from the carve SHOWING their script span;
      // author calls fill body/motion/exiting/audio as they land. One tap, 1 + N
      // reasoner calls, labeled on the button. Revisions are per-row (re-author/edit).
      {
        const poolUrls = freshPoolUrls(refs);
        const carve = await storyboardCarve({ script, style, references: poolUrls, shotLength }, ctx);
        const shots = carve.shots.map((s) => ({
          beat: s.beat, shotTemplate: s.shotTemplate, figures: s.figures, durationSec: s.durationSec,
          intExt: s.intExt, develops: s.develops, span: s.span,
          body: s.span, motion: '', exiting: '', audio: '', expression: '', authorPending: true,
        }));
        const syncChat = () => setNodes((ns) => ns.map((n) => (n.id === nodeId
          ? { ...n, data: { ...n.data, busy: false, shots: [...shots], refs, shotCount: shots.length } }
          : n)));
        syncChat();
        Message.info(`${shots.length} shots carved — authoring each in parallel…`);
        applyShotCards(panelId, [...shots], [], refs, { style, imageModel });
        let flagged = 0;
        await runWithConcurrency(shots.map((s, i) => async () => {
          try {
            const a = await storyboardAuthor({
              script, span: s.span, beat: s.beat, shotTemplate: s.shotTemplate, develops: s.develops,
              prevBeat: shots[i - 1]?.beat || '', nextBeat: shots[i + 1]?.beat || '', references: poolUrls,
              durationSec: s.durationSec,
            }, ctx);
            shots[i] = { ...shots[i], body: a.body, motion: a.motion, exiting: a.exiting, audio: a.audio, expression: a.expression, authorPending: false, missingDialogue: a.missingDialogue || [] };
            if (a.missingDialogue?.length) flagged += 1;
          } catch (e) {
            shots[i] = { ...shots[i], authorPending: false, authorError: e.message };
            flagged += 1;
          }
          syncChat();
          applyShotCards(panelId, [...shots], [], refs, { style, imageModel });
        }), 4);
        syncChat();
        if (flagged) Message.warning(`Authoring done — ${flagged} shot${flagged === 1 ? '' : 's'} flagged (dropped dialogue or an error); check the marked rows before rendering.`);
        else Message.success('Authoring done — every span carried, dialogue verified.');
      }
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, busy: false } } : n)));
      Message.error(`Division failed: ${err.message}`);
    }
  }, [apiKey, applyShotCards, setNodes]);

  // Snapshot each row's render stash (index order) BEFORE a surgery permutes the list.
  const captureRowStash = useCallback((panelId, count) => Array.from({ length: count }, (_, i) => {
    const d = nodesRef.current.find((n) => n.id === `${panelId}-${i}`)?.data || {};
    return KF_STASH.reduce((a, k) => (d[k] !== undefined ? { ...a, [k]: d[k] } : a), {});
  }), []);

  // Index-addressed row ids mean surgery MUST NOT run while a render or author call is
  // in flight — the completion would land on whichever shot NOW owns that index.
  const panelRowsBusy = useCallback((panelId, count) => Array.from({ length: count }, (_, i) => nodesRef.current.find((n) => n.id === `${panelId}-${i}`)?.data || {})
    .some((d) => d.loading || d.endLoading || d.authorPending), []);

  // ROW SURGERY CORE: rebuild the strip from (shots, stash) parallel arrays — cards are
  // recreated 0..N-1 (ids are index-addressed), positions re-pitched, panel resized,
  // the control node's list updated. Deterministic: no LLM ever touches the words here.
  const rewritePanelRows = useCallback((chatId, newShots, newStash = []) => {
    setNodes((ns) => {
      const chat = ns.find((n) => n.id === chatId);
      if (!chat) return ns;
      const panelId = chat.data.panelId;
      const refs = chat.data.refs || [];
      const style = chat.data.style || '';
      const imageModel = imageModelKeyOf(chat.data.imageModel);
      const panel = ns.find((n) => n.id === panelId);
      const base = panel?.position || { x: 0, y: 0 };
      let next = ns.filter((n) => !(String(n.id).startsWith(`${panelId}-`) && /^\d+$/.test(String(n.id).slice(panelId.length + 1))));
      newShots.forEach((sh, i) => {
        const kf = createAssetNode({ kind: 'image', url: '', label: sh.beat, position: base, layerId: 'storyboard' });
        next = next.concat({ ...kf, id: `${panelId}-${i}`, hidden: true, data: { ...kf.data, ...kfCardData(sh, i, refs, style, imageModel, panelId), ...(newStash[i] || {}) } });
      });
      return next.map((n) => (n.id === chatId ? { ...n, data: { ...n.data, shots: newShots, shotCount: newShots.length } } : n));
    });
  }, [setNodes]);

  // Patch ONE shot on both surfaces (its row card + the control node's list). markStale
  // flags a rendered still whose text just moved on.
  const patchShotAt = useCallback((chatId, idx, patch, { markStale = false } = {}) => {
    setNodes((ns) => {
      const chat = ns.find((n) => n.id === chatId);
      if (!chat) return ns;
      const cardId = `${chat.data.panelId}-${idx}`;
      return ns.map((n) => {
        if (n.id === chatId) return { ...n, data: { ...n.data, shots: (n.data.shots || []).map((sh, i) => (i === idx ? { ...sh, ...patch } : sh)) } };
        if (n.id === cardId) {
          const hasStill = !!(n.data.url || n.data.cacheUrl);
          return { ...n, data: { ...n.data, ...patch, ...(patch.beat ? { label: patch.beat } : {}), ...(markStale && hasStill ? { staleStill: true } : {}) } };
        }
        return n;
      });
    });
  }, [setNodes]);

  // Re-run the AUTHOR on ONE shot — its verbatim span + the director's note → ONE
  // focused call; the dialogue gate re-runs; neighbors are untouched by construction.
  const reAuthorShot = useCallback(async (chatId, idx, note = '') => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const shots = chat?.data?.shots || [];
    const sh = shots[idx];
    if (!sh) return;
    const log = (text) => Message.info(text);
    patchShotAt(chatId, idx, { authorPending: true, authorError: '' });
    traceRef.current.startRun({ note: 'Agent · Storyboard (re-author one shot)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const a = await storyboardAuthor({
        script: chat.data.script || '', span: sh.span || sh.body || '', beat: sh.beat, shotTemplate: sh.shotTemplate,
        develops: !!String(sh.exiting || '').trim() || !!sh.develops,
        prevBeat: shots[idx - 1]?.beat || '', nextBeat: shots[idx + 1]?.beat || '',
        references: freshPoolUrls(chat.data.refs || []), note, durationSec: sh.durationSec,
      }, ctx);
      patchShotAt(chatId, idx, { body: a.body, motion: a.motion, exiting: a.exiting, audio: a.audio, expression: a.expression, authorPending: false, missingDialogue: a.missingDialogue || [], authorError: '' }, { markStale: true });
      log(a.missingDialogue?.length
        ? `Re-authored shot ${idx + 1} — ⚠ dropped dialogue: ${a.missingDialogue.join(' · ')}`
        : `Re-authored shot ${idx + 1} from its span${note ? ' + your note' : ''} — dialogue verified.`);
    } catch (e) {
      patchShotAt(chatId, idx, { authorPending: false, authorError: e.message });
      Message.error(`Re-author of shot ${idx + 1} failed: ${e.message}`);
    }
  }, [apiKey, patchShotAt, setNodes]);

  // THE CONSTRAINED ACTION BAR dispatcher — 1 of M, structured args, zero routing LLM.
  // Surgery (cut/add placement) is pure code; only note/add AUTHORING spends a call.
  const storyboardListAction = useCallback(async (chatId, { action, shot = 0, to = 0, note = '' } = {}) => {
    const chat = nodesRef.current.find((n) => n.id === chatId);
    if (!chat) return;
    const panelId = chat.data.panelId;
    const shots = [...(chat.data.shots || [])];
    const log = (text) => Message.info(text);
    if (action === 'note') { await reAuthorShot(chatId, shot, note); return; }
    if (panelRowsBusy(panelId, shots.length)) { Message.warning('A still or author call is mid-flight — let it land before cutting, adding or re-dividing.'); return; }
    if (action === 'cut') {
      if (!shots[shot]) return;
      const beat = shots[shot].beat;
      const stash = captureRowStash(panelId, shots.length);
      shots.splice(shot, 1); stash.splice(shot, 1);
      rewritePanelRows(chatId, shots, stash);
      log(`Cut shot ${shot + 1} — "${beat}". ${shots.length} left, renumbered.`);
      return;
    }
    if (action === 'move') {
      const dest = Math.max(0, Math.min(shots.length - 1, Number(to)));
      if (!shots[shot] || dest === shot) return;
      const stash = captureRowStash(panelId, shots.length);
      const [ms] = shots.splice(shot, 1); shots.splice(dest, 0, ms);
      const [mt] = stash.splice(shot, 1); stash.splice(dest, 0, mt);
      rewritePanelRows(chatId, shots, stash);
      log(`Moved shot ${shot + 1} → ${dest + 1}.`);
      return;
    }
    if (action === 'add') {
      const text = String(note || '').trim();
      const at = Math.min(shots.length, shot + 1);
      const fresh = {
        beat: 'New shot', shotTemplate: 'medium-shot', figures: (chat.data.refs || []).length ? [1] : [],
        body: text, motion: '', exiting: '', audio: '', expression: '', durationSec: 10, intExt: '',
        span: text, authorPending: !!text,
      };
      const stash = captureRowStash(panelId, shots.length);
      shots.splice(at, 0, fresh); stash.splice(at, 0, {});
      rewritePanelRows(chatId, shots, stash);
      log(`Added shot ${at + 1}${text ? ' — authoring from your note (verbatim as its span)…' : ' — blank; write it on the row, or give it a note.'}`);
      if (text) await reAuthorShot(chatId, at, '');
      return;
    }
    if (action === 'redivide') {
      setNodes((ns) => {
        let next = ns.filter((n) => !(String(n.id).startsWith(`${panelId}-`) && /^\d+$/.test(String(n.id).slice(panelId.length + 1))));
        return next.map((n) => (n.id === chatId ? { ...n, data: { ...n.data, shots: [], shotCount: 0 } } : n));
      });
      await runDivide(chatId, null, { fresh: true });
    }
  }, [reAuthorShot, captureRowStash, rewritePanelRows, panelRowsBusy, runDivide, setNodes]);

  // MIGRATION: every divided storyboard gets its STRIP node — old GROUP-era panels
  // convert in place, single-element-era saves (no panel node) get one laid below the
  // control card; rows go hidden (the standing hider keeps them so). Idempotent.
  useEffect(() => {
    const t = setTimeout(() => {
      const isRowId = (nid) => /-\d+$/.test(String(nid));
      const chats = nodesRef.current.filter((n) => n.type === 'sbchat' && (n.data?.shots || []).length && n.data?.panelId && !n.data?.stripHidden);
      const stale = chats.some((c) => nodesRef.current.find((x) => x.id === c.data.panelId)?.type !== 'sbstrip')
        || nodesRef.current.some((n) => String(n.id).startsWith('sbpanel-') && !isRowId(n.id) && n.type !== 'sbstrip');
      if (!stale) return;
      setNodes((ns) => {
        let next = ns;
        chats.forEach((chat) => {
          const pid = chat.data.panelId;
          const existing = next.find((x) => x.id === pid);
          const pos = existing?.position || { x: chat.position?.x || 0, y: (chat.position?.y || 0) + (chat.measured?.height || 560) + 30 };
          const strip = { id: pid, type: 'sbstrip', position: pos, data: { chatId: chat.id, layerId: 'storyboard' }, style: { width: 780 } };
          next = existing ? next.map((x) => (x.id === pid ? strip : x)) : next.concat(strip);
        });
        // orphaned non-strip panel shells (chat gone) → drop
        next = next.filter((n) => !(String(n.id).startsWith('sbpanel-') && !isRowId(n.id) && n.type !== 'sbstrip'));
        return next.map((n) => (String(n.id).startsWith('sbpanel-') && isRowId(n.id) && n.data?.keyframe && (!n.hidden || n.parentId) ? { ...n, hidden: true, parentId: undefined } : n));
      });
    }, 400); // after hydration settles
    return () => clearTimeout(t);
  }, [project.id, setNodes]);

  // TAG a strip still into the bible as a FRAME: lands a NEW visible board asset
  // (same url) with the frame role — decoupled from row surgery, so cutting or
  // re-ordering rows never breaks a card that references it. This is how arbitrary
  // storyboard frames become keyframe-pickable chips on ANY SHOT card.
  const tagStripStill = useCallback((nodeId, which = 'start') => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    const isEnd = which === 'end';
    const src = isEnd ? (node.data.endStill?.cacheUrl || node.data.endStill?.url) : (node.data.cacheUrl || node.data.url);
    if (!src) { Message.warning('Render the still first — tagging needs pixels.'); return; }
    const label = `${node.data.beat || 'Frame'}${isEnd ? ' · end' : ''}`;
    if (nodesRef.current.some((n) => n.data?.bibleRole === 'frame' && (n.data?.url === src || n.data?.bibleRefUrl === src))) {
      Message.info(`"${label}" is already tagged as a frame.`);
      return;
    }
    const panel = node.data.panelId ? nodesRef.current.find((n) => n.id === node.data.panelId) : null;
    const pref = panel
      ? { x: (panel.position?.x || 0) + (Number(panel.style?.width) || 780) + 40, y: (panel.position?.y || 0) + (Number(node.data.index) || 0) * 40 }
      : { x: 160, y: 160 };
    const pos = freeOrigin({ w: 230, h: 240, preferred: pref });
    const asset = createAssetNode({ kind: 'image', url: src, label, position: pos, layerId: 'storyboard' });
    setNodes((ns) => ns.concat({ ...asset, data: { ...asset.data, bibleRole: 'frame' } }));
    Message.success(`"${label}" tagged as a FRAME — it's now a reference chip on every SHOT card (enable it, then pick it as a keyframe).`);
  }, [freeOrigin, setNodes]);

  // Delete-key on storyboard rows = CUT those shots: the list shrinks, survivors
  // renumber and re-pitch, their stills travel along. Runs via rowsDeletedRef because
  // onNodesDeleted is declared far above the surgery helpers.
  const handleRowsDeleted = useCallback((deleted) => {
    const byPanel = new Map();
    (deleted || []).forEach((n) => {
      if (n?.data?.keyframe && n.parentId && String(n.parentId).startsWith('sbpanel-')) {
        const arr = byPanel.get(n.parentId) || [];
        arr.push(Number(n.data.index) || 0);
        byPanel.set(n.parentId, arr);
      }
    });
    byPanel.forEach((idxs, panelId) => {
      const chatId = String(panelId).replace('sbpanel', 'sbchat');
      const chat = nodesRef.current.find((n) => n.id === chatId);
      if (!chat) return;
      const del = new Set(idxs);
      const old = chat.data.shots || [];
      const shots = old.filter((_, i) => !del.has(i));
      const stash = old.map((_, i) => {
        const d = nodesRef.current.find((n) => n.id === `${panelId}-${i}`)?.data || {};
        return KF_STASH.reduce((a, k) => (d[k] !== undefined ? { ...a, [k]: d[k] } : a), {});
      }).filter((_, i) => !del.has(i));
      rewritePanelRows(chatId, shots, stash);
      Message.info(`Cut ${del.size === 1 ? `shot ${[...del][0] + 1}` : `${del.size} shots`} — ${shots.length} left, renumbered.`);
    });
  }, [rewritePanelRows, panelRowsBusy, setNodes]);
  useEffect(() => { rowsDeletedRef.current = handleRowsDeleted; }, [handleRowsDeleted]);
  // VETO deleting storyboard rows while their strip has a render/author in flight —
  // rows are index-addressed, so the completion would land on the wrong shot.
  useEffect(() => {
    beforeDeleteRef.current = ({ nodes: dn }) => {
      const blocked = (dn || []).some((n) => {
        if (!n?.data?.keyframe || !n.parentId || !String(n.parentId).startsWith('sbpanel-')) return false;
        const chat = nodesRef.current.find((x) => x.id === String(n.parentId).replace('sbpanel', 'sbchat'));
        return panelRowsBusy(n.parentId, (chat?.data?.shots || []).length);
      });
      if (blocked) Message.warning('A still or author call is mid-flight on this strip — let it land, then delete the row.');
      return !blocked;
    };
  }, [panelRowsBusy]);

  // Spawn the chat node + its keyframe panel group from a script (the Brief node's VERBATIM text).
  // Lays the control node + empty panel INERT — nothing generates on add. The
  // division is an explicit tap on the element (its Divide button); runDivide reads
  // everything from node.data, so no seed is needed.
  const spawnStoryboardChat = useCallback((script, count, refs = [], ethnicity = '', style = '', imageModel = defaultImageModelKey(), shotLength = 'auto') => {
    const text = String(script || '').trim();
    if (!text) { Message.warning('The storyboard needs a script or description first — write it into a Brief node.'); return; }
    const stamp = Date.now().toString(36);
    const nodeId = `sbchat-${stamp}`;
    const panelId = `sbpanel-${stamp}`; // the "big panel" GROUP; the chat is bound to it
    const pref = rfInstance ? rfInstance.screenToFlowPosition({ x: 200, y: 200 }) : { x: 160, y: 160 };
    const pos = freeOrigin({ w: 800, h: SB_PANEL_H, preferred: pref });
    setNodes((ns) => ns.concat(
      { id: nodeId, type: 'sbchat', position: pos, data: { shots: [], panelId, script: text, refs, ethnicity, style, imageModel, shotLength, busy: false, shotCount: 0 } },
    ));
    Message.success('Storyboard on the board — Divide lays the shot list as editable text cards (no renders); stills are rendered per card, or all at once.');
  }, [rfInstance, freeOrigin, setNodes]);

  // Render ONE card's still from its CURRENT fields (the card is the contract): merge any
  // edits onto the shot, re-resolve its figures → refs + renumber the body, write back to the
  // chat's shot list AND the node, then render. This is the per-card "Render still", the
  // Expand editor's Regenerate, AND the fresh path behind ↻ on a text-edited card.
  const saveKeyframeShot = useCallback(async (nodeId, edits = {}) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    const { panelId, index } = node.data;
    const chatId = panelId ? panelId.replace('sbpanel', 'sbchat') : null;
    const chat = chatId && nodesRef.current.find((n) => n.id === chatId);
    const refs = chat?.data?.refs?.length ? freshPoolUrls(chat.data.refs) : (bibleRef.current || []).map((e) => e.url).filter(Boolean);
    const style = chat?.data?.style || node.data.style || '';
    const ethnicity = chat?.data?.ethnicity || '';
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    const { useFrame, annotatedFrame, ...editFields } = edits; // render-mode flags — never persisted onto the shot
    const shot = { beat: node.data.beat, shotTemplate: node.data.shotTemplate, expression: node.data.expression || '', figures: node.data.figures || [], body: node.data.body || '', ...editFields };
    let { ordered, body } = resolveShotRefs(shot, refs);
    // Structure lock: the current still anchors composition; the text drives the change.
    // Drawn marks ride on a BAKED COPY of the frame — [Image 1] becomes the annotated
    // image; the draw template obeys the marks and removes them from the result.
    const frameSrc = (annotatedFrame || node.data.cacheUrl || node.data.url) || '';
    const frameEdit = !!(useFrame && frameSrc);
    if (frameEdit) ({ body, refs: ordered } = lockBodyToFrame(body, ordered, frameSrc));
    // A CAMERA change under the lock is a NAMED change: reframe the same scene to the
    // new framing/angle (wide ⇄ close-up ⇄ aerial matter). Unchanged camera = pure lock.
    if (frameEdit && editFields.shotTemplate && editFields.shotTemplate !== node.data.shotTemplate) {
      const tpl = SHOT_TEMPLATE_BY_ID[editFields.shotTemplate];
      if (tpl) body = `Reframe to a ${tpl.framing}, ${tpl.angle} — the same scene, subjects and moment. ${body}`;
    }
    setNodes((ns) => ns.map((n) => {
      if (n.id === nodeId) return { ...n, data: { ...n.data, ...shot, label: shot.beat, loading: true, error: undefined } };
      if (chat && n.id === chatId && Array.isArray(n.data?.shots)) return { ...n, data: { ...n.data, shots: n.data.shots.map((s, i) => (i === index ? { ...s, ...shot } : s)) } };
      return n;
    }));
    traceRef.current.startRun({ note: `Agent · Storyboard (${frameEdit ? 'edit in place' : 'render still'})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, cacheUrl, prompt: promptUsed } = await storyboardKeyframe({ body, shotTemplate: shot.shotTemplate, style, expression: shot.expression, ethnicity, refs: ordered, imageModel, frameEdit, frameEditAnnotated: !!annotatedFrame }, ctx);
      // renderedFrameEdit rides with bodyRendered/shotRefs so a tile ↻ re-rolls the SAME
      // kind of render (a locked edit re-rolls as a locked edit).
      const stashRefs = annotatedFrame ? [node.data.cacheUrl || node.data.url, ...ordered.slice(1)].filter(Boolean) : ordered; // never persist megabyte annotated data: urls
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || n.data.cacheUrl, loading: false, shotRefs: stashRefs, bodyRendered: body, renderedFrameEdit: frameEdit, promptUsed, staleStill: undefined } } : n)));
      // PAIR: a DEVELOPING shot (the planner wrote an `exiting` sentence) chains its
      // END frame off the still that just landed — same tap, second named spend. The
      // END rides as data.endStill and becomes the card's END anchor at promote.
      const exiting = String((editFields.exiting ?? node.data.exiting) || '').trim();
      if (exiting && !frameEdit) {
        setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: true, endError: undefined } } : n)));
        traceRef.current.startRun({ note: `Agent · Storyboard (END frame · ${String(node.data.beat || '').slice(0, 24)})` });
        try {
          const end = await storyboardEndframe({ exiting, startUrl: cacheUrl || url, refs: ordered, imageModel, shotTemplate: node.data.shotTemplate }, ctx);
          setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endStill: { url: end.url, cacheUrl: end.cacheUrl || null, promptUsed: end.prompt }, endLoading: false } } : n)));
        } catch (e) {
          setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: false, endError: e.message } } : n)));
          Message.warning(`END frame failed (${e.message}) — the START still stands; re-render to retry the pair.`);
        }
      }
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: false, error: err.message } } : n)));
    }
  }, [apiKey, setNodes]);

  // Render EVERY card in a storyboard panel that doesn't have its still yet — the panel's
  // one-tap batch. Renders stream in parallel; cards with stills are left alone.
  // Render ONE storyboard SHEET from the current shot list — the same plan, a second
  // artifact (pitch / share / a 2.5 storyboard-reference asset). The storyboard KIND
  // is a render-time choice, not a spawn-time mode — stills and the page coexist
  // from one division.
  const renderSheetFromChat = useCallback(async (chatId) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const shots = chat?.data?.shots || [];
    const preDivision = !shots.length; // no rows yet → one page straight from the script
    // PANEL BUDGET: the Panels select caps the page. Sampling is DETERMINISTIC —
    // first + last always ride, middles are evenly spaced with a preference for
    // DEVELOPS shots (the big state transitions), no LLM, no spend.
    const target = Number(chat.data?.sheetPanels) || 0;
    let pageShots = shots;
    if (!preDivision && target && shots.length > target) {
      const picked = new Set([0, shots.length - 1]);
      const need = Math.max(0, target - picked.size);
      for (let k = 1; k <= need; k += 1) {
        const ideal = Math.max(1, Math.min(shots.length - 2, Math.round((k * (shots.length - 1)) / (need + 1))));
        const cands = [ideal, ideal - 1, ideal + 1].filter((x) => x > 0 && x < shots.length - 1 && !picked.has(x));
        const dev = cands.find((x) => String(shots[x]?.exiting || '').trim());
        const chosen = dev ?? cands[0];
        if (chosen !== undefined) picked.add(chosen);
      }
      pageShots = [...picked].sort((a, b) => a - b).map((i2) => shots[i2]);
      Message.info(`Page condensed to ${pageShots.length} of ${shots.length} shots — first, last and the biggest transitions.`);
    }
    if (!preDivision && pageShots.length > 15) Message.warning(`${pageShots.length} panels — the Seedream guide advises ≤15 per page; ordering may suffer.`);
    // The Quick Storyboard lands directly BELOW the Shot Division control card (its
    // own board element); freeOrigin nudges it clear of the strip when both are there.
    const pos = freeOrigin({ w: 760, h: 480, preferred: { x: chat.position?.x || 0, y: (chat.position?.y || 0) + (chat.measured?.height || 560) + 30 } });
    const title = String(chat.data?.script || '').split(/[.\n]/)[0].trim().slice(0, 50);
    const nodeId = `sbsheet-${Date.now().toString(36)}`;
    const base = createAssetNode({ kind: 'image', url: '', label: `Quick Storyboard${title ? ` — ${title}` : ''}`, position: pos });
    setNodes((ns) => ns.concat({ ...base, id: nodeId, data: { ...base.data, loading: true } }));
    const quickPanels = target || 6;
    traceRef.current.startRun({ note: 'Agent · Storyboard (Quick Storyboard · ' + (preDivision ? quickPanels + ' panels from script' : pageShots.length + ' panels') + ')' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = preDivision
        ? await storyboardQuickPage({ script: chat.data?.script || '', panels: quickPanels, style: chat.data?.style || '', references: freshPoolUrls(chat.data?.refs || []), imageModel: imageModelKeyOf(chat.data?.imageModel) }, ctx)
        : await storyboardSheet({ shots: pageShots, style: chat.data?.style || '', title, references: freshPoolUrls(chat.data?.refs || []), imageModel: imageModelKeyOf(chat.data?.imageModel) }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, url: out.url, cacheUrl: out.cacheUrl || null, loading: false } } : n)));
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: false, error: err.message } } : n)));
      Message.error(`Page render failed: ${err.message}`);
    }
  }, [apiKey, setNodes, freeOrigin]);

  const renderAllStills = useCallback(async (chatId) => {
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const panelId = chat?.data?.panelId;
    if (!panelId) return;
    // Pending = never rendered OR stale (the words moved after the render) — a batch
    // "make the pixels match the text" pass, never touching up-to-date pairs.
    const pending = nodesRef.current.filter((n) => String(n.id).startsWith(`${panelId}-`) && n.data?.keyframe
      && (!(n.data.url || n.data.cacheUrl) || n.data.staleStill) && !n.data.loading);
    if (!pending.length) { Message.info('Every still matches its text — nothing to render.'); return; }
    Message.info(`Rendering ${pending.length} still${pending.length === 1 ? '' : 's'} — cells fill as they land.`);
    await Promise.all(pending.map((n) => saveKeyframeShot(n.id, {})));
  }, [saveKeyframeShot]);

  // ENHANCE a rendered still IN PLACE — the agentic finishing pass: 1 VLM look (writes
  // the tailored change-only instruction) + 1 structure-locked edit. Works on a row's
  // START still or its END frame; the text is untouched so nothing goes stale.
  const enhanceRowStill = useCallback(async (nodeId, which = 'start') => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    const isEnd = which === 'end';
    const src = isEnd ? (node.data.endStill?.cacheUrl || node.data.endStill?.url) : (node.data.cacheUrl || node.data.url);
    if (!src) { Message.warning('Render the still first — Enhance upgrades an existing frame.'); return; }
    if (node.data.loading || node.data.endLoading) { Message.warning('A render is in flight on this row — let it land first.'); return; }
    const chatId = node.data.panelId ? String(node.data.panelId).replace('sbpanel', 'sbchat') : null;
    const chat = chatId ? nodesRef.current.find((n) => n.id === chatId) : null;
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    const busyKey = isEnd ? 'endLoading' : 'loading';
    const setPhase = (ph) => setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, enhancePhase: ph } } : n)));
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, [busyKey]: true, enhancePhase: 'look', error: undefined, endError: undefined } } : n)));
    traceRef.current.startRun({ note: `Agent · Enhance still (${isEnd ? 'END · ' : ''}${String(node.data.beat || '').slice(0, 24)} · 1 VLM + 1 image)` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await enhanceStill({ imageUrl: src, context: isEnd ? (node.data.exiting || '') : (node.data.body || ''), imageModel, onPhase: setPhase }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? {
        ...n,
        data: {
          ...n.data,
          [busyKey]: false,
          enhancePhase: undefined,
          // in place — the enhanced frame replaces the old one; provenance of the old
          // src is dropped so nothing stale (localUrl/assetId) can shadow it
          ...(isEnd
            ? { endStill: { url: out.url, cacheUrl: out.cacheUrl || null, promptUsed: out.prompt } }
            : { url: out.url, cacheUrl: out.cacheUrl || null, promptUsed: out.prompt, localUrl: undefined, assetId: undefined, preserved: undefined }),
        },
      } : n)));
      Message.success(`Enhanced${isEnd ? ' END frame' : ''} — ${out.instruction.slice(0, 140)}${out.instruction.length > 140 ? '…' : ''}`);
    } catch (e) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, [busyKey]: false, enhancePhase: undefined } } : n)));
      Message.error(`Enhance failed: ${e.message}`);
    }
  }, [apiKey, setNodes]);

  // Re-roll ONLY the END frame — the boundary-iteration loop: the chained edit re-runs
  // from the CURRENT start still + CURRENT end-state sentence; the START never re-renders.
  // One named image spend per tap.
  const renderEndOnly = useCallback(async (nodeId) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    const exiting = String(node.data.exiting || '').trim();
    if (!exiting) { Message.warning('This shot HOLDS — write an END state first (shot editor).'); return; }
    const startUrl = node.data.cacheUrl || node.data.url;
    if (!startUrl) { Message.warning('Render the still first — the END frame chains off it.'); return; }
    const chatId = node.data.panelId ? String(node.data.panelId).replace('sbpanel', 'sbchat') : null;
    const chat = chatId ? nodesRef.current.find((n) => n.id === chatId) : null;
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: true, endError: undefined } } : n)));
    traceRef.current.startRun({ note: `Agent · Storyboard (END re-roll · ${String(node.data.beat || '').slice(0, 24)})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const end = await storyboardEndframe({ exiting, startUrl, refs: node.data.shotRefs || [], imageModel, shotTemplate: node.data.shotTemplate }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endStill: { url: end.url, cacheUrl: end.cacheUrl || null, promptUsed: end.prompt }, endLoading: false } } : n)));
      Message.success('END frame re-rolled — the START stands untouched.');
    } catch (e) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: false, endError: e.message } } : n)));
      Message.error(`END re-roll failed: ${e.message}`);
    }
  }, [apiKey, setNodes]);

  // TEXT-ONLY row patch (free, nothing renders): the inline double-click body edit or a
  // beat rename. A real text change on a row that already has a still marks staleStill
  // so the still pane says so. (showText is a dead legacy flag — stripped, never applied.)
  const patchKeyframeText = useCallback((nodeId, patch = {}) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    const { panelId, index } = node.data;
    const chatId = panelId ? panelId.replace('sbpanel', 'sbchat') : null;
    const hasStill = !!(node.data.url || node.data.cacheUrl);
    const { showText, ...shotPatch } = patch;
    // Only fields that feed PIXELS invalidate them: body/template/expression/figures →
    // the START still; exiting → the chained END frame. motion/audio/duration/intExt
    // ride to the take, not the still — they sync to the list without staling anything.
    const STILL_KEYS = ['body', 'shotTemplate', 'expression', 'figures', 'exiting', 'beat'];
    const touchesStill = Object.keys(shotPatch).some((k) => STILL_KEYS.includes(k));
    setNodes((ns) => ns.map((n) => {
      if (n.id === nodeId) return { ...n, data: { ...n.data, ...patch, ...(shotPatch.beat ? { label: shotPatch.beat } : {}), ...(touchesStill && hasStill ? { staleStill: true } : {}) } };
      if (Object.keys(shotPatch).length && chatId && n.id === chatId && Array.isArray(n.data?.shots)) return { ...n, data: { ...n.data, shots: n.data.shots.map((s, i) => (i === index ? { ...s, ...shotPatch } : s)) } };
      return n;
    }));
  }, [setNodes]);

  // Per-keyframe edit (the director's camera-angle / facial-expression loop): patch the shot on the
  // keyframe node (and its chat's shot list, if present), then re-render JUST that still — reusing the
  // shot's OWN rendered body + its assigned figures (stashed on the node), so the same [Image N]
  // references hold. `patch` is {shotTemplate}/{expression} or {} for a plain ↻ regenerate.
  const editKeyframe = useCallback(async (nodeId, patch = {}) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return;
    // A never-rendered card, or one whose TEXT moved since its last render, has no valid
    // bodyRendered — render from the CURRENT card fields instead (the card is the contract).
    if (!node.data.bodyRendered || node.data.staleStill) return saveKeyframeShot(nodeId, patch);
    const { panelId, index } = node.data;
    const chatId = panelId ? panelId.replace('sbpanel', 'sbchat') : null;
    const chat = chatId && nodesRef.current.find((n) => n.id === chatId);
    const style = chat?.data?.style || node.data.style || '';
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    const merged = { shotTemplate: node.data.shotTemplate, expression: node.data.expression || '', ...patch };
    const body = node.data.bodyRendered || '';        // already renumbered to attach order
    const shotRefs = node.data.shotRefs || [];         // this shot's figures, in [Image 1..N] order
    setNodes((ns) => ns.map((n) => {
      if (n.id === nodeId) return { ...n, data: { ...n.data, ...patch, loading: true, error: undefined } };
      if (chat && n.id === chatId && Array.isArray(n.data?.shots)) {
        return { ...n, data: { ...n.data, shots: n.data.shots.map((s, i) => (i === index ? { ...s, ...patch } : s)) } };
      }
      return n;
    }));
    traceRef.current.startRun({ note: 'Agent · Storyboard (keyframe edit)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const { url, cacheUrl, prompt: promptUsed } = await storyboardKeyframe({ body, shotTemplate: merged.shotTemplate, style, expression: merged.expression, refs: shotRefs, imageModel, frameEdit: !!node.data.renderedFrameEdit }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, url, cacheUrl: cacheUrl || n.data.cacheUrl, promptUsed, loading: false } } : n)));
      // A fresh roll is a NEW composition — a DEVELOPS shot re-chains its END so the
      // pair never silently mismatches.
      const exiting2 = String(node.data.exiting || '').trim();
      if (exiting2 && !node.data.renderedFrameEdit) {
        setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: true, endError: undefined } } : n)));
        try {
          const end = await storyboardEndframe({ exiting: exiting2, startUrl: cacheUrl || url, refs: shotRefs, imageModel, shotTemplate: merged.shotTemplate }, ctx);
          setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endStill: { url: end.url, cacheUrl: end.cacheUrl || null, promptUsed: end.prompt }, endLoading: false } } : n)));
        } catch (e2) {
          setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: false, endError: e2.message } } : n)));
          Message.warning(`END re-chain failed (${e2.message}) — the new START stands; END ↻ retries the pair's second frame.`);
        }
      }
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: false, error: err.message } } : n)));
    }
  }, [apiKey, setNodes, saveKeyframeShot]);

  // ---- Keyframe Expand editor: see/edit the whole shot (body + references + camera/expression) ----
  // (Its Regenerate = saveKeyframeShot above — same fresh-render path as the card's Render still.)
  const [expandedKeyframeId, setExpandedKeyframeId] = useState(null);
  // The END frame opens in the SAME Edit-shot UI: instruction edit + draw marks +
  // camera-under-lock reframe, applied through the one frameEdit grammar; the result
  // replaces endStill in place. Pair GENERATION is untouched.
  const [endEditId, setEndEditId] = useState(null);
  const [startEditId, setStartEditId] = useState(null);
  // Pixels-only edit of the START still, in place: same frameEdit grammar, same pool
  // mechanics as the END editor. Text untouched → nothing goes stale; the END keeps
  // its chain to the pre-edit composition (locked edits hold framing) — END ↻ pulls
  // the improvement across when wanted.
  const applyStartFrameEdit = useCallback(async (nodeId, edits = {}) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    const src = node?.data?.cacheUrl || node?.data?.url;
    if (!src) return;
    const { annotatedFrame, body = '', shotTemplate, figures } = edits;
    let instruction = String(body || '').trim();
    if (!instruction && !annotatedFrame) { Message.warning('Describe the change — the frame edits by instruction (or draw marks).'); return; }
    const chatId = node.data.panelId ? String(node.data.panelId).replace('sbpanel', 'sbchat') : null;
    const chat = chatId ? nodesRef.current.find((n) => n.id === chatId) : null;
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    const editorPool = [src, ...freshPoolUrls(chat?.data?.refs || [])];
    const ticked = [1, ...((Array.isArray(figures) ? figures : []).filter((f) => f > 1))];
    const { ordered, body: renumbered } = resolveShotRefs({ figures: ticked, body: instruction }, editorPool);
    instruction = renumbered;
    if (shotTemplate && shotTemplate !== node.data.shotTemplate) {
      const t = SHOT_TEMPLATE_BY_ID[shotTemplate];
      if (t) instruction = `Reframe to a ${t.framing}, ${t.angle} — the same scene, subjects and moment. ${instruction}`;
    }
    const refsToSend = [annotatedFrame || ordered[0] || src, ...ordered.slice(1)];
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: true, error: undefined } } : n)));
    traceRef.current.startRun({ note: `Agent · Storyboard (START frame edit · ${String(node.data.beat || '').slice(0, 24)})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await storyboardKeyframe({ body: instruction, refs: refsToSend, imageModel, frameEdit: true, frameEditAnnotated: !!annotatedFrame }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, url: out.url, cacheUrl: out.cacheUrl || null, promptUsed: out.prompt, localUrl: undefined, assetId: undefined, preserved: undefined, loading: false } } : n)));
      Message.success('START frame edited in place — text untouched, nothing stale. END ↻ re-chains from it when you want.');
    } catch (e) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, loading: false, error: e.message } } : n)));
      Message.error(`START edit failed: ${e.message}`);
    }
  }, [apiKey, setNodes]);
  const applyEndFrameEdit = useCallback(async (nodeId, edits = {}) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    const src = node?.data?.endStill?.cacheUrl || node?.data?.endStill?.url;
    if (!src) return;
    const { annotatedFrame, body = '', shotTemplate, figures } = edits;
    let instruction = String(body || '').trim();
    if (!instruction && !annotatedFrame) { Message.warning('Describe the change — the END frame edits by instruction (or draw marks).'); return; }
    const chatId = node.data.panelId ? String(node.data.panelId).replace('sbpanel', 'sbchat') : null;
    const chat = chatId ? nodesRef.current.find((n) => n.id === chatId) : null;
    const imageModel = imageModelKeyOf(chat?.data?.imageModel || node.data.imageModel);
    // The editor's pool = [END frame, ...the storyboard's ref pool]. Ticked refs ride
    // behind the frame (props/casting for the change); the instruction's [Image N]
    // numbers are renumbered to the attach order by the shared resolver.
    const editorPool = [src, ...freshPoolUrls(chat?.data?.refs || [])];
    const ticked = [1, ...((Array.isArray(figures) ? figures : []).filter((f) => f > 1))];
    const { ordered, body: renumbered } = resolveShotRefs({ figures: ticked, body: instruction }, editorPool);
    instruction = renumbered;
    if (shotTemplate && shotTemplate !== node.data.shotTemplate) {
      const t = SHOT_TEMPLATE_BY_ID[shotTemplate];
      if (t) instruction = `Reframe to a ${t.framing}, ${t.angle} — the same scene, subjects and moment. ${instruction}`;
    }
    const refsToSend = [annotatedFrame || ordered[0] || src, ...ordered.slice(1)];
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: true, endError: undefined } } : n)));
    traceRef.current.startRun({ note: `Agent · Storyboard (END frame edit · ${String(node.data.beat || '').slice(0, 24)})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const out = await storyboardKeyframe({ body: instruction, refs: refsToSend, imageModel, frameEdit: true, frameEditAnnotated: !!annotatedFrame }, ctx);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endStill: { url: out.url, cacheUrl: out.cacheUrl || null, promptUsed: out.prompt }, endLoading: false } } : n)));
      Message.success('END frame edited in place — the START stands untouched.');
    } catch (e) {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, endLoading: false, endError: e.message } } : n)));
      Message.error(`END edit failed: ${e.message}`);
    }
  }, [apiKey, setNodes]);

  // Re-derive ONE shot's [Image N] body for a chosen figure set (the editor's "Re-derive from
  // references" — run after toggling/adding references). Returns { body, expression }; the editor
  // shows it for review before Regenerate. Does NOT save on its own.
  const rederiveKeyframeBody = useCallback(async (nodeId, figures) => {
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return null; }
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node?.data?.keyframe) return null;
    const chatId = node.data.panelId ? node.data.panelId.replace('sbpanel', 'sbchat') : null;
    const chat = chatId && nodesRef.current.find((n) => n.id === chatId);
    traceRef.current.startRun({ note: 'Agent · Storyboard (re-derive shot)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    return await storyboardShotBody({ script: chat?.data?.script || '', beat: node.data.beat, figures, style: chat?.data?.style || node.data.style || '', references: freshPoolUrls(chat?.data?.refs) }, ctx);
  }, [apiKey]);

  // Add a board image to a storyboard's reference POOL (the editor's "Add reference"). Downscales fat
  // data: urls (like every ref path), appends to the chat node's data.refs → it becomes [Image N+1].
  const addReferenceToPool = useCallback(async (chatId, url) => {
    const u = String(url || '').startsWith('data:') ? await downscaleRef(url) : url;
    const bn = nodesRef.current.find((n) => refUrl(n) === url);
    const ent = (bn && bibleRef.current.find((b) => b.nodeId === bn.id)) || bibleRef.current.find((b) => b.url === url);
    let newIndex = 0;
    setNodes((ns) => ns.map((n) => {
      if (n.id === chatId) {
        const refs = [...(n.data.refs || []).map(poolRef), { entryId: ent?.id || null, nodeId: bn?.id || null, url: u, label: bn?.data?.label || ent?.name || 'reference' }];
        newIndex = refs.length;
        return { ...n, data: { ...n.data, refs } };
      }
      return n;
    }));
    return newIndex; // 1-based [Image N] number of the added reference
  }, [setNodes]);

  // Deterministic dispatch of a CONFIRMED chat action to the existing machinery.
  // Returns the chat's reply line.
  const dispatchFilmAction = useCallback(async (action, params = {}) => {
    const selImages = nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    // When an agent runs with no explicit premise, fall back to the SELECTED Brief node's text.
    const selStoryIdea = () => nodesRef.current.find((n) => n.type === 'story' && n.selected)?.data?.idea?.trim() || '';
    switch (action) {
      case 'inspiration': {
        // Strip-launched "Explore the look" sends no prompt — seed from the selected story.
        const inspPrompt = params.prompt || params.beat || selStoryIdea();
        if (!inspPrompt.trim()) return 'Tell me what to riff on first — a premise, a mood, or a reference. Describe the idea, then explore the look.';
        await runAgent({ agentId: 'inspiration', settings: { ...AGENT_MAP.inspiration.defaultSettings, prompt: inspPrompt }, selectionNodes: selImages });
        return 'Inspiration board added — these are style/mood candidates, not cast. Next: tag the ONE look you love as Look (the “+ tag role” on its card), then draft the production — tagging scenes in mixed styles as cast makes an inconsistent film.';
      }
      case 'characterVariations': {
        const targets = selImages.length ? selImages : nodesForRole('character');
        if (!targets.length) return 'Select your character on the board (or tag one as Character in the bible) and ask again.';
        await runAgent({ agentId: 'characterVariations', settings: { ...AGENT_MAP.characterVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Character variations on the board. Tag the take you like as Character — the strip up top moves with you.';
      }
      case 'locationVariations': {
        const targets = selImages.length ? selImages : nodesForRole('location');
        if (!targets.length) return 'Select a location on the board (or tag one in the bible) and ask again.';
        await runAgent({ agentId: 'locationVariations', settings: { ...AGENT_MAP.locationVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Location coverage on the board. Tag the angles you want as Location anchors.';
      }
      case 'classify': {
        const roles = await classifyBoardAssets();
        return roles.length
          ? `Sorted — ${roles.length} image${roles.length === 1 ? '' : 's'} tagged (${[...new Set(roles)].join(', ')}). Fix any role on its node badge.`
          : 'Nothing to sort — drop a few untagged images on the board first.';
      }
      case 'story': {
        // Brief holds the user's words VERBATIM — each ask spawns a NEW Brief card
        // instantly (no rewrite; Develop stays opt-in on the card); the card appearing
        // IS the feedback.
        const ideaText = (params.prompt || '').trim();
        if (!ideaText) return 'Tell me what the film is about — one sentence is enough.';
        createStoryNode({ idea: ideaText });
        return '';
      }
      case 'storyboard': {
        const sel = nodesRef.current.find((n) => n.type === 'story' && n.selected && String(n.data?.idea || '').trim());
        if (!sel) return 'Select a Brief node with a script — I\'ll spin up a shot-division chat to break it into shots with you.';
        // Lays the element INERT — the division itself is a tap on the node.
        if (storyboardRunRef.current) storyboardRunRef.current(String(sel.data.idea).trim(), params.count);
        return 'Storyboard is on the board — press Divide on it (or type guidance into its chat) to run the division.';
      }
      case 'split': {
        const sel = nodesRef.current.find((n) => n.type === 'story' && n.selected && String(n.data?.idea || '').trim());
        if (!sel) return `Select a Brief node with a script first — I'll break it into ≤${maxShotSeconds(defaultVideoModelKey())}s SHOT cards ready to shoot.`;
        splitBriefToShots(sel.id); // async fire-and-forget: the cards landing IS the feedback
        return '';
      }
      case 'detectGenre': {
        // The genre detector: read genre & tone from the premise FIRST, surface it
        // as one-tap chips. Picking a chip locks the genre and runs castDraft — so
        // the highest-leverage creative call is made (and steerable) before any spend.
        const idea = (params.prompt || selStoryIdea()).trim();
        if (!idea) return 'Give me the film idea (or select a Brief node) first — one sentence is enough.';
        traceRef.current.startRun({ note: 'Agent · Read genre' });
        const gctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
        const g = await detectGenre({ idea }, gctx);
        const primary = [g.genre, g.tone].filter(Boolean).join(' · ');
        const mkChoice = (label) => ({ label, action: 'castDraft', params: { prompt: idea, genre: label } });
        return {
          say: `I read this as “${primary}”${g.treatment ? ` — ${g.treatment}` : ''}. Tap to lock the genre and draft the production, or pick another take:`,
          choices: [mkChoice(primary), ...g.alternatives.map(mkChoice)],
        };
      }
      case 'castDraft': {
        const idea = (params.prompt || selStoryIdea()).trim();
        if (!idea) return 'Give me the film idea (or select a Brief node) first — one sentence is enough.';
        traceRef.current.startRun({ note: `Agent · ${castAgent.label}` });
        const castCtx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
        // Lay the "Cast & World" PANEL the moment the run starts — BEFORE the genre and
        // cast reads — so the tap answers instantly (the storyboard panel behaves the same
        // way). It opens as a slim frame with a status line; when the read returns, onPlan
        // resizes it in place into the plate grid, one LOADING cell per planned plate.
        // Unique id per draft → a re-draft makes a fresh panel in open space.
        const PANEL_ID = `cast-${Date.now().toString(36)}`;
        const CAST_COLS = 4;
        const preferred = params.near || (rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 180 }) : { x: 120, y: 120 });
        const slotPos = (i) => ({ x: GROUP_PAD + (i % CAST_COLS) * PLATE_COL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(i / CAST_COLS) * PLATE_ROW_H });
        const slotIds = []; // plan index → child node id, so each plate fills its own cell
        const panelW = GROUP_PAD * 2 + CAST_COLS * PLATE_COL_W;
        // Pick the spot as if the grid were already ~2 plate rows tall, so growing in
        // place at plan time doesn't cover neighbours (a typical draft runs 1–3 rows).
        const base = freeOrigin({ w: panelW, h: GROUP_HEADER + GROUP_PAD + 2 * PLATE_ROW_H, preferred });
        const setPanelPhase = (phase) => setNodes((ns) => ns.map((n) => (n.id === PANEL_ID ? { ...n, data: { ...n.data, phase } } : n)));
        setNodes((ns) => {
          const grid = createGroupNode({ label: 'Cast & World', position: base, width: panelW, height: GROUP_HEADER + 56 });
          grid.data.phase = 'Reading the brief — casting the characters, places and look…';
          return ns.concat({ ...grid, id: PANEL_ID });
        });
        try {
          // Genre = the picked chip, else the project's, else a quick read (strip path).
          let genre = (params.genre || '').trim() || (projectRef.current?.genre?.line || '');
          if (!genre) { const g = await detectGenre({ idea }, castCtx); genre = [g.genre, g.tone].filter(Boolean).join(' · '); }
          onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, genre: { line: genre } } : prev));
          pushFilmNote(`Drafting as ${genre} — characters, places and a look render into the Cast & World panel below.`);
          setPanelPhase(`Drafting as ${genre} — deciding the characters, places and look…`);
          const { created: entries } = await castAgent.run({
            prompt: idea, settings: { genre, imageModel: imageModelKeyOf(params.imageModel), imageThinking: !!params.imageThinking, ethnicity: params.ethnicity || '' }, ctx: castCtx,
            // onPlan: swap the status line for a LOADING cell per planned plate the instant
            // the read returns, so the whole pending block shows at once. AUTO-TAG: stamp
            // bibleRole + locked NOW — the draft IS the bible (children are still picked
            // up by the reconciler regardless of the panel parent).
            onPlan: (specs) => {
              const rows = Math.max(1, Math.ceil(specs.length / CAST_COLS));
              const h = GROUP_HEADER + GROUP_PAD + rows * PLATE_ROW_H;
              setNodes((ns) => {
                // parent already on the board BEFORE children (RF ordering)
                let next = ns.map((n) => (n.id === PANEL_ID ? { ...n, style: { ...n.style, width: panelW, height: h }, data: { ...n.data, phase: '' } } : n));
                specs.forEach((s, i) => {
                  const node = createAssetNode({ kind: 'image', url: '', label: s.name, position: slotPos(i), layerId: 'cast' });
                  node.data.loading = true;
                  node.data.bibleRole = s.role;
                  slotIds[i] = node.id;
                  next = next.concat({ ...node, parentId: PANEL_ID });
                });
                return next;
              });
            },
            // onEntry: a plate finished (or failed) — fill its loading cell, or drop the cell if
            // it failed so no blank placeholder lingers in the panel.
            onEntry: (c, i) => {
              const id = slotIds[i];
              if (c.failed) { if (id) setNodes((ns) => ns.filter((n) => n.id !== id)); return; }
              let plateId = id;
              if (id) {
                setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url: c.url, cacheUrl: c.cacheUrl || n.data.cacheUrl, loading: false } } : n)));
              } else {
                const node = createAssetNode({ kind: 'image', url: c.url, label: c.name, position: slotPos(i), layerId: 'cast' });
                node.data.cacheUrl = c.cacheUrl || null;
                node.data.bibleRole = c.role;
                plateId = node.id;
                setNodes((ns) => ns.concat({ ...node, parentId: PANEL_ID }));
              }
              // Cast & World plates are the PRIMARY video references — graduate each to
              // the Library the moment it lands (background, quiet): the trusted asset://
              // id is registered up front, so the first 🎬 never pays registration latency
              // or risks the person screen on a raw url. Failure only warns; the lazy
              // pre-shoot registration remains the safety net.
              setTimeout(() => {
                const n = nodesRef.current.find((x) => x.id === plateId);
                if (n && !n.data?.preserved) {
                  preserveNode(n).catch((e) => Message.warning(`“${String(c.name || 'plate').slice(0, 24)}” Library check-in failed (will retry at first shoot): ${e.message}`));
                }
              }, 50);
            },
          });
          return `${entries.length} cast & world asset${entries.length === 1 ? '' : 's'} drafted and auto-tagged into the bible — the pipeline strip moved forward. Re-roll any you don't like with Character / Location Variations, then write the brief.`;
        } catch (err) {
          // The draft died with nothing to show (bad read, every plate failed) — take the
          // placeholder panel (and any cells) off the board so no dead frame lingers,
          // then let the caller surface the error exactly as before.
          setNodes((ns) => ns.filter((n) => n.id !== PANEL_ID && n.parentId !== PANEL_ID));
          throw err;
        }
      }
      case 'action': {
        if (!nodesRef.current.some((n) => n.type === 'cut')) return 'No cards to shoot yet — add a Brief, then New Shot on the Brief card drops a SHOT card.';
        handleAction(); // fire-and-forget: a multi-shot run takes minutes; the timeline shows progress
        return 'Rolling — shooting the cards in order. Watch the timeline fill in; cards already shot keep their takes.';
      }
      case 'stitch': {
        if (renderMovieRef.current) renderMovieRef.current();
        return 'Stitching the rendered shots into the final cut — it lands on the timeline (▶ to watch).';
      }
      case 'nextStep': {
        // "Continue" is deterministic: the first unfinished pipeline stage — the LLM
        // routed the word, nothing more.
        const next = livePipeline().find((s) => s.status !== 'done');
        if (!next) return 'Everything is done — the film is cut. Press ▶ on the timeline to watch it, or start a new idea.';
        switch (next.id) {
          case 'ideation':
            // NOTE: 'storyboard' (Brief) completes in lockstep with 'ideation' — both key
            // off the verbatim brief text — so this rung covers both; a 'storyboard' rung
            // here would be unreachable dead code.
            return 'First I need the brief — tell me what the film is about (one sentence is enough, or paste a whole script). I\'ll drop it on the board as a Brief card, verbatim, and we take it from there.';
          case 'casting':
            return {
              say: `Next is casting & world (${next.note}). I can draft the whole production from the brief — characters, places and a look, all in one shared style; you tag the keepers.`,
              next: { action: 'castDraft', say: 'Draft the production' },
            };
          case 'filming':
            return {
              say: `Next: shoot (${next.note}). Edit any card first — cards already shot keep their takes.`,
              next: { action: 'action', say: 'Shoot the cards' },
            };
          case 'finalCut':
            return {
              say: 'All shots are in — last step: stitch them into the final cut.',
              next: { action: 'stitch', say: 'Stitch the film' },
            };
          default:
            return `Next: ${next.label.toLowerCase()} — ${next.note}.`;
        }
      }
      default:
        return "I don't know that move yet.";
    }
  }, [runAgent, nodesForRole, classifyBoardAssets, handleAction, apiKey, onUpdateProject, rfInstance, setNodes, livePipeline, pushFilmNote, freeOrigin, createStoryNode, splitBriefToShots, preserveNode]);

  // handleRenderMovie is declared below (it reads live timeline state); the
  // dispatch above reaches it through this ref to avoid a declaration-order knot.
  const renderMovieRef = useRef(null);

  // The Cast & World rail agent's Run reuses the castDraft dispatch (declared just
  // above) — same genre gate, plate streaming and auto look board as the strip/chat,
  // so the rail trigger behaves identically. Bridged via the ref declared up top.
  // The Brief node's Cast button carries no settings surface — it honors the cast
  // panel's saved draft defaults (model / thinking / ethnicity).
  castRunRef.current = (idea, imageModel, imageThinking) => {
    const d = layerSettings.cast || {};
    return dispatchFilmAction('castDraft', {
      prompt: idea,
      imageModel: imageModel || d.imageModel,
      imageThinking: imageThinking != null ? imageThinking : d.imageThinking,
      ethnicity: d.ethnicity || '',
    });
  };

  // The Brief rail agent's Run: land a NEW Brief card holding the typed words VERBATIM —
  // no LLM call (Develop / Cast & World / Storyboard / New Shot run from the card itself).
  storyRunRef.current = (idea) => { createStoryNode({ idea: (idea || '').trim() }); };
  storyboardRunRef.current = spawnStoryboardChat;

  // ---- agents as BOARD ELEMENTS -----------------------------------------------------
  // Every agent is a card on the board (AgentNode): its settings live in node.data.settings
  // (persisted), Run sits on the card, outputs land BESIDE it. The rail/context menu is a
  // PALETTE — a tap drops the card (free, instant); nothing is configured in a side panel.
  const spawnAgentNode = useCallback((agentId, { at = null, preset = null } = {}) => {
    if (!AGENT_MAP[agentId]) return null;
    const settings = { ...(AGENT_MAP[agentId].defaultSettings || {}), ...(preset || {}) };
    const pref = at || (rfInstance ? rfInstance.screenToFlowPosition({ x: 280, y: 200 }) : { x: 180, y: 180 });
    const position = freeOrigin({ w: 250, h: 150, preferred: pref });
    // The card lands SELECTED (everything else deselects) so the LayerPanel opens on it
    // immediately — the rail tap flows straight into configuration; nothing runs yet.
    const node = { id: `agent-${agentId}-${Date.now().toString(36)}`, type: 'agent', position, data: { agentId, settings }, selected: true };
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(node));
    return node.id;
  }, [rfInstance, freeOrigin, setNodes]);

  const patchAgentSettings = useCallback((nodeId, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, settings: { ...(n.data.settings || {}), ...patch } } } : n)));
  }, [setNodes]);

  // Run THIS agent card: read its own settings, land outputs beside it. Same handlers
  // the old panel Run invoked — the card is just where the tap and the config live now.
  const runAgentNode = useCallback(async (nodeId) => {
    const node = nodesRef.current.find((n) => n.id === nodeId && n.type === 'agent');
    if (!node || agentRunning.includes(nodeId)) return;
    const agentId = node.data.agentId;
    const layer = AGENT_MAP[agentId];
    const s = node.data.settings || {};
    if (!layer) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    const beside = { x: (node.position?.x || 0) + Math.round(node.measured?.width || 300) + 60, y: node.position?.y || 0 };
    // Grouped agents lay a titled panel — estimate its box so the pinned origin is open space.
    const groupOrigin = () => {
      const count = Math.min(Math.max(Number(s.count) || 6, 1), 12);
      const cols = Math.min(count, 4);
      return freeOrigin({
        w: GROUP_PAD * 2 + cols * CELL_W,
        h: GROUP_HEADER + GROUP_PAD + Math.ceil(count / cols) * CELL_H,
        preferred: beside,
      });
    };
    setAgentRunning((r) => [...r, nodeId]);
    try {
      if (agentId === 'cast') {
        // Same convention as the storyboard: typed idea wins; EMPTY runs on the
        // SELECTED Brief's verbatim text; neither → one warning.
        const typed = (s.prompt || '').trim();
        const selStory = !typed && nodesRef.current.find((n) => n.type === 'story' && n.selected && String(n.data?.idea || '').trim());
        if (!typed && !selStory) { Message.warning('Type the film idea — or select a Brief node and leave the field empty.'); return; }
        const idea = typed || String(selStory.data.idea).trim();
        await dispatchFilmAction('castDraft', { prompt: idea, imageModel: s.imageModel, imageThinking: !!s.imageThinking, ethnicity: s.ethnicity || '', near: beside });
        Message.success('Cast & World drafted and auto-tagged into the bible');
      } else if (agentId === 'previz') {
        const typed = (s.brief || '').trim();
        const selStory = !typed && nodesRef.current.find((n) => n.type === 'story' && n.selected && String(n.data?.idea || '').trim());
        if (!typed && !selStory) { Message.warning('Type the scene text — or select a Brief node and leave the field empty.'); return; }
        await runFloorPlan({ brief: typed || String(selStory.data.idea).trim(), near: beside });
      } else if (agentId === 'audio') {
        await runAudioClip({ text: s.prompt, voice: s.voice, instruction: s.instruction, model: s.model || 'seedAudio', imageRef: s.imageRef || '', audioRefs: s.audioRefs || [], near: beside });
      } else if (agentId === 'characterVariations' || agentId === 'locationVariations') {
        const anchor = nodesRef.current.find((n) => n.id === s.anchorId && n.data?.kind === 'image' && n.data?.url);
        if (!anchor) { Message.warning('Pick the source image on the card first.'); return; }
        const { result } = await runAgent({ agentId, settings: s, selectionNodes: [anchor], origin: groupOrigin() });
        Message.success(result?.async ? `${layer.label} started` : `${layer.label} finished`);
      } else if (agentId === 'inspiration') {
        const picked = (s.refs || []).map((rid) => nodesRef.current.find((x) => x.id === rid))
          .filter((n) => n && n.data?.kind === 'image' && n.data?.url);
        const { result } = await runAgent({ agentId, settings: s, selectionNodes: picked, origin: groupOrigin() });
        Message.success(result?.async ? `${layer.label} started` : `${layer.label} finished`);
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setAgentRunning((r) => r.filter((x) => x !== nodeId));
    }
  }, [agentRunning, apiKey, dispatchFilmAction, runFloorPlan, runAudioClip, runAgent, freeOrigin]);

  // Drop a fresh SHOT card carrying the draft panel's preset (prompt verbatim, camera,
  // duration) — everything stays editable ON the card afterwards. The live board
  // SELECTION pre-populates the card's references: bible-tagged images arrive as
  // their identity chips (refIds), untagged images as per-shot assets, audio/video
  // clips as media reference chips — so select → SHOT lands a ready-wired card.
  const dropEmptyShotCard = useCallback((at = null, preset = {}) => {
    if (!storyboardPanelRef.current) return;
    const pref = at || (rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 220 }) : { x: 220, y: 220 });
    const base = freeOrigin({ w: CUT_COL_W, h: CUT_ROW_H, preferred: pref });
    const cut = nodesRef.current.filter((n) => n.type === 'cut' && String(n.id).startsWith('film-')).length;
    const text = (preset.prompt || '').trim();
    const refEntryIds = []; const assetRefs = []; const audioRefs = []; const videoRefs = [];
    nodesRef.current.filter((n) => n.selected && refUrl(n)).forEach((n) => {
      const u = refUrl(n);
      if (n.data?.kind === 'image') {
        const be = bibleRef.current.find((b) => b.nodeId === n.id) || bibleRef.current.find((b) => b.url && b.url === u);
        if (be) { if (!refEntryIds.includes(be.id)) refEntryIds.push(be.id); }
        else if (!assetRefs.some((a) => a.url === u)) assetRefs.push({ nodeId: n.id, url: u, label: n.data.label || 'asset' });
      } else if (n.data?.kind === 'audio') {
        audioRefs.push({ nodeId: n.id, url: n.data.cacheUrl || n.data.url, label: n.data.label || 'audio clip', duration: Number(n.data.duration) || null });
      } else if (n.data?.kind === 'video') {
        videoRefs.push({ nodeId: n.id, url: n.data.cacheUrl || n.data.url, label: n.data.label || 'take' });
      }
    });
    const refCap = videoTraits(defaultVideoModelKey()).refCap;
    if (refEntryIds.length + assetRefs.length > refCap) {
      Message.warning(`${refEntryIds.length + assetRefs.length} images selected — the video model takes ${refCap} references; the first ${refCap} ride.`);
      assetRefs.length = Math.max(0, refCap - refEntryIds.length);
    }
    storyboardPanelRef.current({
      index: 0, cut, idPrefix: `film-${Date.now().toString(36)}`, title: 'Shot',
      action: text, promptOverride: text, framing: '', shotTemplate: preset.shotTemplate || 'medium-shot',
      durationSec: preset.durationSec || maxShotSeconds(defaultVideoModelKey()), refEntryIds, audio: '',
      assetRefs, audioRefs, videoRefs,
    }, base);
    const attached = refEntryIds.length + assetRefs.length + audioRefs.length + videoRefs.length;
    Message.success(attached
      ? `SHOT card on the board — ${attached} selected reference${attached > 1 ? 's' : ''} attached.`
      : 'SHOT card on the board — edit it, attach refs, then 🎬 to shoot.');
  }, [rfInstance, freeOrigin]);

  // The rail / context-menu tap OPENS THE CONFIGURATION PANEL — nothing lands on the
  // board from a click. Configure the agent there; its primary button then ADDS the
  // configured element (or runs the selection-verb). Draft settings persist per project
  // in layerSettings; variations pre-bind the selected image as their source.
  const handleRailTap = useCallback((layerId) => {
    if (!AGENT_MAP[layerId]) return;
    panelAtRef.current = originOverride.current || null;
    originOverride.current = null;
    if (layerId === 'characterVariations' || layerId === 'locationVariations') {
      const sel = nodesRef.current.find((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
      if (sel) setLayerSettings((prev) => ({ ...prev, [layerId]: { ...(prev[layerId] || {}), anchorId: sel.id } }));
    }
    // Deselect agent CARDS only (a selected card would keep the panel bound to it);
    // the Brief selection survives — the storyboard verb needs it.
    setNodes((ns) => ns.map((n) => (n.type === 'agent' && n.selected ? { ...n, selected: false } : n)));
    setPanelAgentId(layerId);
  }, [setNodes]);

  // The draft panel's primary: ADD the configured element to the board — or, for the
  // two selection-verbs, run it. Adding is free and inert: the agent card lands with
  // the draft settings, selected, so the panel rebinds to it and Run is the next tap.
  const panelPrimary = useCallback(async () => {
    const id = panelAgentId;
    if (!id) return;
    const d = { ...(AGENT_MAP[id]?.defaultSettings || {}), ...(layerSettings[id] || {}) };
    const at = panelAtRef.current;
    const closePanel = () => { setPanelAgentId(null); panelAtRef.current = null; };
    if (id === 'story') {
      // The Brief card holds the typed words VERBATIM — no LLM call.
      createStoryNode({ idea: (d.prompt || '').trim() });
      closePanel();
      Message.success((d.prompt || '').trim()
        ? 'Brief card on the board — develop, cast, storyboard or shoot from it'
        : 'Empty Brief card on the board — type your idea or paste a script into it');
      return;
    }
    if (id === 'shot') { dropEmptyShotCard(at, d); closePanel(); return; }
    if (id === 'storyboard') {
      // SELF-SUSTAINED: the storyboard element OWNS its script — typed text rides
      // onto the control card VERBATIM (editable there in the SCRIPT section);
      // empty lands an empty card to type into. No Brief card is created or read.
      const typed = (d.script || '').trim();
      const text = typed;
      // Pool entries keep their IDENTITY ({entryId?, nodeId, url, label}) so the chat
      // node's REFS block shows named, numbered, toggleable chips; fat data: sources
      // are downscaled like every other ref path.
      const refs = (await Promise.all((d.refs || []).map(async (rid) => {
        const n = nodesRef.current.find((x) => x.id === rid); const u = n && refUrl(n);
        if (!u) return null;
        const url = u.startsWith('data:') ? await downscaleRef(u) : u;
        const ent = bibleRef.current.find((b) => b.nodeId === n.id) || bibleRef.current.find((b) => b.url === u);
        return { entryId: ent?.id || null, nodeId: n.id, url, label: n.data?.label || ent?.name || 'reference' };
      }))).filter(Boolean);
      spawnStoryboardChat(text, d.count, refs, d.ethnicity || '', d.style || '', imageModelKeyOf(d.imageModel), d.shotLength || 'auto');
      // The scene field is ONE-SHOT: it became a Brief card — a stale copy must not
      // silently re-board old text on the next panel open.
      if (typed) setLayerSettings((prev) => ({ ...prev, storyboard: { ...(prev.storyboard || {}), script: '' } }));
      closePanel();
      return;
    }
    spawnAgentNode(id, { at, preset: d });
    closePanel();
  }, [panelAgentId, layerSettings, createStoryNode, dropEmptyShotCard, spawnStoryboardChat, spawnAgentNode]);

  const agentCtx = useMemo(() => ({
    onRun: runAgentNode, imageAssets, runningIds: agentRunning,
  }), [runAgentNode, imageAssets, agentRunning]);

  // Render movie: stitch the timeline's rendered shots IN EVENT ORDER (so reorders
  // and trims are honored) into the final cut — same server ffmpeg + TOS as the engine.
  const handleRenderMovie = useCallback(async () => {
    const shots = orderedEvents(timelineEvents).filter((e) => e.shotUrl).map((e) => durableVideoUrl(e.shotUrl));
    if (!shots.length) { Message.warning('No rendered shots yet — Auto-fill or animate the keyframes first.'); return; }
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    setRenderBusy(true);
    try {
      const out = await createBrowserTransport((apiKey || '').trim()).stitch(shots, { name: (project.title || 'film').slice(0, 40) });
      updateTimeline((cur) => ({ ...cur, film: { url: out.url, assetId: out.assetId || null, builtAt: new Date().toISOString() } }));
      Message.success('Final cut assembled');
    } catch (err) {
      Message.error(`Render failed: ${err.message}`);
    } finally {
      setRenderBusy(false);
    }
  }, [timelineEvents, apiKey, project.title, updateTimeline, durableVideoUrl]);
  renderMovieRef.current = handleRenderMovie;

  // Drag a board asset / Library item onto the spine → a new manual keyframe event.
  const addAssetToTimeline = useCallback(({ url, label }) => {
    if (!url) return;
    updateTimeline((cur) => {
      const evs = cur.events || [];
      const nextOrder = evs.length ? Math.max(...evs.map((e) => e.order || 0)) + 1 : 0;
      return { ...cur, events: [...evs, timelineEvent({ order: nextOrder, beat: label || `Shot ${nextOrder + 1}`, keyframeUrl: url, status: 'keyframe' })] };
    });
    Message.success('Added to timeline');
  }, [updateTimeline]);

  const addSelectedToTimeline = useCallback(() => {
    const sel = nodesRef.current.find((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    if (!sel) { Message.warning('Select a board image first'); return; }
    addAssetToTimeline({ url: refUrl(sel), assetId: sel.data.assetId || null, label: sel.data.label });
  }, [addAssetToTimeline]);

  // A rendered TAKE → the Final Cut timeline (the EDL that Stitch concatenates, in order).
  // The take's NODE id rides on the event, so removing the take (from the board or just the
  // timeline) drops the clip — and an empty timeline makes Stitch inactive again.
  const addTakeToTimeline = useCallback((takeId) => {
    const take = nodesRef.current.find((n) => n.id === takeId && n.data?.kind === 'video' && n.data?.url);
    if (!take) return;
    updateTimeline((cur) => {
      const evs = cur.events || [];
      if (evs.some((e) => e.shotNodeId === takeId)) return cur; // already on the timeline
      const nextOrder = evs.length ? Math.max(...evs.map((e) => e.order || 0)) + 1 : 0;
      return { ...cur, events: [...evs, timelineEvent({ order: nextOrder, beat: take.data.label || `Shot ${nextOrder + 1}`, shotUrl: take.data.url, shotNodeId: takeId, status: 'shot' })] };
    });
    Message.success('Added to the Final Cut timeline');
  }, [updateTimeline]);

  const removeTakeFromTimeline = useCallback((takeId) => {
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => e.shotNodeId !== takeId) }));
  }, [updateTimeline]);

  const setEventDuration = useCallback((id, sec) => {
    const secs = Math.max(1, Math.min(60, Number(sec) || 5));
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).map((e) => (e.id === id ? { ...e, durationSec: secs } : e)) }));
    const ev = timelineEvents.find((e) => e.id === id);
    if (ev?.stepId && sessionRef.current) {
      const step = sessionRef.current.state.plan.find((s) => s.id === ev.stepId);
      sessionRef.current.editStep(ev.stepId, { params: { ...(step?.params || {}), duration: secs } });
    }
  }, [updateTimeline, timelineEvents]);

  const toggleEventLock = useCallback((id) => {
    const ev = timelineEvents.find((e) => e.id === id);
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).map((e) => (e.id === id ? { ...e, locked: !e.locked } : e)) }));
    if (ev?.stepId) sessionRef.current?.editStep(ev.stepId, { locked: !ev.locked });
  }, [updateTimeline, timelineEvents]);

  // Reordering on the spine is THE re-ordering gesture for cuts too: after the
  // swap, CUT cards renumber to match the new event order, so the next Action /
  // stitch follows what the timeline shows. Cards without a take keep their
  // relative slot (ranked between shot ones by their current number).
  const moveEvent = useCallback((id, dir) => {
    const list = orderedEvents(timelineEvents);
    const i = list.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const next = renumber(list);
    updateTimeline((cur) => ({ ...cur, events: next }));
    const orderByStep = new Map(next.filter((e) => e.stepId).map((e) => [e.stepId, e.order]));
    setNodes((ns) => {
      const cuts = ns.filter((n) => n.type === 'cut');
      if (!cuts.length || !cuts.some((c) => orderByStep.has(c.data?.lastAnimStepId))) return ns;
      const rank = (c) => (orderByStep.has(c.data?.lastAnimStepId) ? orderByStep.get(c.data.lastAnimStepId) : (c.data?.cut ?? 0) + 0.5);
      const ranked = [...cuts].sort((a, b) => rank(a) - rank(b));
      const cutById = new Map(ranked.map((n, k) => [n.id, k]));
      return ns.map((n) => (n.type === 'cut' && cutById.get(n.id) !== (n.data?.cut ?? 0) ? { ...n, data: { ...n.data, cut: cutById.get(n.id) } } : n));
    });
  }, [timelineEvents, updateTimeline, setNodes]);

  const removeEvent = useCallback((id) => {
    const ev = timelineEvents.find((e) => e.id === id);
    if (ev?.stepId) sessionRef.current?.removeStep(ev.stepId); // engine event → drop the step (mirror removes it)
    updateTimeline((cur) => ({ ...cur, events: renumber((cur.events || []).filter((e) => e.id !== id)) }));
    if (ev?.keyframeNodeId) { // a Story Director beat → also clear its board node + edges
      setNodes((ns) => ns.filter((n) => n.id !== ev.keyframeNodeId));
      setEdges((es) => es.filter((e) => e.source !== ev.keyframeNodeId && e.target !== ev.keyframeNodeId));
    }
    if (selectedEventId === id) setSelectedEventId(null);
  }, [timelineEvents, updateTimeline, setNodes, setEdges, selectedEventId]);

  // Regenerate a shot, steered by the user's note (the human-in-the-loop filter).
  // Phase A iterates at the clip altitude: re-run the animate step (the keyframe —
  // already bible-consistent — is untouched), so the result stays consistent.
  const regenerateEvent = useCallback((id, note) => {
    const ev = timelineEvents.find((e) => e.id === id);
    if (!ev?.stepId) { Message.info('Auto-fill the timeline to iterate on shots.'); return; }
    const s = sessionRef.current;
    // A shot frozen from an EARLIER fill isn't in the live session — say so rather
    // than silently doing nothing (an interval Auto-fill starts a fresh session).
    if (!s || !s.state.plan.some((step) => step.id === ev.stepId)) {
      Message.info('This shot is from an earlier fill — Auto-fill the whole timeline to iterate it.');
      return;
    }
    s.regenerate(ev.stepId, { note });
    if (s.state.mode === 'auto') s.resume().catch((err) => Message.error(err.message));
  }, [timelineEvents]);

  const selectEventOnBoard = useCallback((eventId) => {
    setSelectedEventId(eventId);
    const ev = timelineEvents.find((e) => e.id === eventId);
    if (!ev) return;
    const url = ev.keyframeUrl || ev.shotUrl;
    const node = nodesRef.current.find((n) => n.id === ev.keyframeNodeId || n.id === ev.shotNodeId || n.data?.url === url);
    if (node) selectAndCenter(node.id);
  }, [timelineEvents, selectAndCenter]);

  // ---- context menu (appears on area-select release, or right-click) ----
  const selStart = useRef(null);

  const openMenuAtClient = useCallback((clientX, clientY) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const wrapperW = rect?.width || 800;
    const wrapperH = rect?.height || 600;
    let x = clientX - (rect?.left || 0);
    let y = clientY - (rect?.top || 0);
    if (rfInstance) {
      originOverride.current = rfInstance.screenToFlowPosition({ x: clientX, y: clientY });
    }
    // Keep the menu fully inside the canvas; scroll if it's still too tall.
    const MENU_W = 240;
    const estH = 48 + AGENTS.length * 52; // header + rows estimate
    const maxHeight = Math.max(160, wrapperH - 16);
    const menuH = Math.min(estH, maxHeight);
    if (x + MENU_W > wrapperW) x = Math.max(8, wrapperW - MENU_W - 8);
    if (y + menuH > wrapperH) y = Math.max(8, wrapperH - menuH - 8);
    setCtxMenu({ x, y, maxHeight });
  }, [rfInstance]);

  const openContextMenu = useCallback((event) => {
    event.preventDefault();
    openMenuAtClient(event.clientX, event.clientY);
  }, [openMenuAtClient]);

  // Marquee select: remember where the drag began…
  // Drag a CHILD past its panel's edge → it DETACHES to the open board (absolute
  // position, no parent); the panel frame stays — the storyboard panel must survive
  // for reconciliation, and an empty variations frame is a visible, deletable thing.
  // (Take nodes are hidden data, undraggable by construction — no re-pack needed.)
  const handleNodeDragStop = useCallback((_e, node) => {
    if (!node?.parentId) return;
    const gridId = node.parentId;
    setNodes((ns) => {
      const grid = ns.find((n) => n.id === gridId);
      if (!grid) return ns;
      const nw = node.measured?.width || 220;
      const nh = node.measured?.height || 280;
      const gridW = grid.style?.width || GROUP_PAD * 2 + TAKE_COLS * CELL_W;
      const gridH = grid.style?.height || GROUP_HEADER + GROUP_PAD + TAKE_CELL_H;
      const cx = (node.position?.x || 0) + nw / 2;
      const cy = (node.position?.y || 0) + nh / 2;
      if (cx >= 0 && cx <= gridW && cy >= 0 && cy <= gridH) return ns; // still inside
      const abs = { x: (grid.position?.x || 0) + (node.position?.x || 0), y: (grid.position?.y || 0) + (node.position?.y || 0) };
      return ns.map((n) => (n.id === node.id ? { ...n, parentId: undefined, extent: undefined, position: abs } : n));
    });
  }, [setNodes]);

  const onSelectionStart = useCallback((event) => {
    selStart.current = { x: event.clientX, y: event.clientY };
    setCtxMenu(null);
    setSelectedEventId(null); // marquee = working on the board → leave clip mode
  }, []);

  // …and when the mouse is released, pop the agent menu at the release point —
  // but only if it was a real area-drag, not an accidental click.
  const onSelectionEnd = useCallback((event) => {
    const start = selStart.current;
    selStart.current = null;
    const cx = event?.clientX ?? start?.x ?? 0;
    const cy = event?.clientY ?? start?.y ?? 0;
    const moved = start ? Math.hypot(cx - start.x, cy - start.y) : 999;
    if (moved < 8) return; // treat as a click/deselect, not an area selection
    openMenuAtClient(cx, cy);
  }, [openMenuAtClient]);

  // ARCHIVE the selected media into the persistent Library, then clear them off the
  // board — the pressure valve for finished exploration (fewer nodes, smaller saves).
  // Bible-tagged / locked nodes are refused: archiving an anchor would break every
  // card that references it. Structure (cards, briefs, chats, agents) never archives.
  const [archiving, setArchiving] = useState(false);
  const archiveSelection = useCallback(async () => {
    const sel = nodesRef.current.filter((n) => n.selected && n.type === 'asset'
      && ['image', 'video', 'audio'].includes(n.data?.kind) && (n.data?.cacheUrl || n.data?.url));
    const kept = sel.filter((n) => n.data?.bibleRole);
    const toGo = sel.filter((n) => !n.data?.bibleRole);
    if (!toGo.length) {
      Message.warning(kept.length
        ? 'The selected assets are bible-tagged or locked — untag/unlock first.'
        : 'Select media assets (images, video, audio) to archive.');
      return;
    }
    setArchiving(true);
    try {
      let ok = 0;
      for (const n of toGo) {
        const url = n.data.cacheUrl || n.data.url; // the store copy outlives signed remotes
        try {
          // eslint-disable-next-line no-await-in-loop
          await addToLibrary({ url, thumb: n.data.kind === 'image' ? url : null, assetId: n.data.assetId || null, name: n.data.label || n.data.kind, kind: n.data.kind });
          ok += 1;
          const id = n.id;
          setNodes((ns) => ns.filter((x) => x.id !== id));
          setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
        } catch (e) {
          Message.error(`Could not archive “${n.data.label || n.data.kind}”: ${e.message}`);
        }
      }
      if (ok) Message.success(`${ok} asset${ok === 1 ? '' : 's'} archived${kept.length ? ` (${kept.length} bible/locked kept)` : ''} — the Library (▤ in the zoom stack) brings them back.`);
      if (libraryOpen) refreshLibrary();
    } finally { setArchiving(false); }
  }, [setNodes, setEdges, libraryOpen, refreshLibrary]);

  // The MiniMap earns its render cost ONLY when it can show something the viewport
  // can't — i.e. at least one node sits fully off-screen. Everything in view → hidden.
  const [mapNeeded, setMapNeeded] = useState(false);
  const recomputeMapNeeded = useCallback(() => {
    const el = wrapperRef.current;
    if (!rfInstance || !el) return;
    const { x, y, zoom } = rfInstance.getViewport();
    const view = { x: -x / zoom, y: -y / zoom, w: el.clientWidth / zoom, h: el.clientHeight / zoom };
    const out = nodesRef.current.some((n) => {
      if (n.parentId) return false; // children live inside their group's box
      const r = nodeRect(n);
      return r.x + r.w < view.x || r.x > view.x + view.w || r.y + r.h < view.y || r.y > view.y + view.h;
    });
    setMapNeeded((m) => (m === out ? m : out));
  }, [rfInstance]);
  useEffect(() => { recomputeMapNeeded(); }, [nodes.length, recomputeMapNeeded]);

  // Zoom-out LOD: below this zoom, media nodes render as flat tint tiles (no <img>/
  // <video>/<audio> elements) — the fit-view-on-a-big-board cliff. State only flips
  // when the threshold is CROSSED, so panning/zooming never re-renders per tick.
  const LOD_ZOOM = 0.45;
  const [lodCoarse, setLodCoarse] = useState(false);
  const onViewportMove = useCallback((e, viewport) => {
    const coarse = viewport.zoom < LOD_ZOOM;
    setLodCoarse((c) => (c === coarse ? c : coarse));
  }, []);

  const handleContextPick = useCallback((layerId) => {
    setCtxMenu(null);
    // The right-click / marquee-release spot (originOverride) becomes the drop point;
    // variations pre-bind the selection as their source image.
    handleRailTap(layerId);
  }, [handleRailTap]);

  // Right-click → "Text note": a plain note lands AT the click point. No panel, no agent.
  const handleContextAddNote = useCallback(() => {
    setCtxMenu(null);
    const at = originOverride.current || null;
    originOverride.current = null;
    createNoteNode({ at });
  }, [createNoteNode]);

  const selectionCount = selectedNodes.length;
  // One Lock TOGGLE for the whole selection: if everything selected is already locked the
  // button unlocks, otherwise it locks (icon/label reflect the action it will take).
  const canAddSelected = useMemo(() => selectedNodes.some((n) => n.data?.kind === 'image' && n.data?.url), [selectedNodes]);
  // Board images not yet tagged into the bible — what "Build brand kit" classifies.
  const untaggedImageCount = useMemo(() => nodes.filter((n) => n.data?.kind === 'image' && (n.data?.localUrl || n.data?.url)
    && !n.data?.bibleRole && !n.id.startsWith('shot-') && !n.id.startsWith('film-')).length, [nodes]);
  // Where the project stands in the explicit Film pipeline — derived from the
  // actual artifacts (never a stored checklist). The director chat reads this so
  // the user always knows the stage and the next step (TRANSPARENCY).
  const filmPipeline = useMemo(() => {
    // Brief ✓ = a Brief node with VERBATIM text (the developed prompt is opt-in).
    const brief = nodes.find((n) => n.type === 'story' && String(n.data?.idea || '').trim())?.data?.idea || '';
    return pipelineStatus({
      idea: brief,
      storyPrompt: brief,
      bibleEntries,
      cutCards: nodes.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
      filmUrl: timeline.film?.url || '',
      candidates: untaggedImageCount,
    });
  }, [bibleEntries, nodes, timeline.film, untaggedImageCount]);
  // Narrate pipeline-stage completions in the director chat (e.g. the tag that
  // completes casting): the user's off-chat actions advance the conversation too.
  // DEBOUNCED: the Brief stage completes on the FIRST KEYSTROKE into a Brief textarea
  // (per-keystroke edits + verbatim-text keying), so let the done status hold for a
  // beat before narrating — and re-check it live so a deleted draft never narrates.
  // Multiple stages completing in one pass collapse to ONE note (the furthest stage).
  const stagePrevRef = useRef(null);
  const stageNoteTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(stageNoteTimerRef.current), []);
  useEffect(() => {
    if (!filmMode) { stagePrevRef.current = null; clearTimeout(stageNoteTimerRef.current); return; }
    const prev = stagePrevRef.current;
    stagePrevRef.current = Object.fromEntries(filmPipeline.map((s) => [s.id, s.status]));
    if (!prev) return;
    const completed = filmPipeline.filter((s) => prev[s.id] && prev[s.id] !== 'done' && s.status === 'done');
    if (!completed.length) return;
    const stage = completed[completed.length - 1];
    clearTimeout(stageNoteTimerRef.current);
    stageNoteTimerRef.current = setTimeout(() => {
      const live = livePipeline();
      if ((live.find((x) => x.id === stage.id) || {}).status !== 'done') return; // regressed while waiting
      const next = live.find((x) => x.status !== 'done');
      pushFilmNote(next
        ? `${stage.label} ✓ — next: ${next.label.toLowerCase()}. Say “continue” and I'll line it up, or pick it from the left rail.`
        : `${stage.label} ✓ — the film is complete. Press ▶ on the timeline.`);
    }, 1500);
  }, [filmPipeline, filmMode, pushFilmNote, livePipeline]);

  // A preserved image whose link went bad heals itself: the bytes are safe in
  // TOS (that's what check-in means) — only the LINK can die (private bucket →
  // the unsigned url 403s; or a presign lapsed). Mint a fresh signed link and
  // swap it in; the bible reconciler then carries the healed url downstream.
  // Capped per node so a genuinely dead object can't loop.
  const healTriesRef = useRef({});
  const healNodeUrl = useCallback(async (id) => {
    const tries = healTriesRef.current;
    if ((tries[id] || 0) >= 2) return;
    tries[id] = (tries[id] || 0) + 1;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node?.data?.url) return;
    try {
      const { url, objectKey } = await resignAsset({ url: node.data.url, objectKey: node.data.objectKey });
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url, tosUrl: url, objectKey } } : n)));
    } catch (err) {
      Message.warning(`Could not refresh “${node.data.label || 'asset'}”: ${err.message}`);
    }
  }, [setNodes]);

  // ---- TAKE POSTERS — video cards render a still, never a live <video> ----------
  // Dozens of mounted players (a decoder + metadata fetch each) made big boards
  // crawl. Each video node asks ONCE per session: the first frame is extracted
  // server-side (ffmpeg — no model spend), checked into the media store, and
  // stamped as data.posterUrl — which serializes, so the next open costs nothing.
  // Playback lives in the Take Viewer only.
  const posterAskedRef = useRef(new Set());
  const posterQueueRef = useRef({ running: 0, waiting: [] }); // ≤3 extractions in flight — a 34-take board must not stampede ffmpeg
  const ensurePoster = useCallback((nodeId) => {
    if (posterAskedRef.current.has(nodeId)) return;
    posterAskedRef.current.add(nodeId);
    const run = async () => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      const src = node && absLocalMediaUrl(node.data?.cacheUrl || node.data?.url || '');
      if (!src || src.startsWith('data:')) return;
      try {
        // maxWidth: a poster is a thumbnail — full-res frames painted at card size make
        // zoom re-rasterize megapixels. posterScaled marks the downscaled generation so
        // earlier full-res stamps self-heal on their next open.
        const res = await fetch('/api/film/frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src, timestamps: [0], maxWidth: 512 }) });
        const out = await res.json();
        const posterUrl = out?.frames?.[0]?.url;
        // A data: fallback would bloat the manifest — stamp only a store url.
        if (!res.ok || !posterUrl || posterUrl.startsWith('data:')) return;
        setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, posterUrl, posterScaled: true } } : n)));
      } catch { /* the card keeps its inert tile — the Take Viewer still plays it */ }
    };
    const q = posterQueueRef.current;
    const next = () => {
      if (!q.waiting.length || q.running >= 3) return;
      q.running += 1;
      q.waiting.shift()().finally(() => { q.running -= 1; next(); });
    };
    q.waiting.push(run);
    next();
  }, [setNodes]);

  // The director's ✕ = RESET all the way back to the "What are we making?" launcher
  // — that IS the initial board state. So besides
  // wiping the board/takes/idea, it CLEARS THE RECIPE (recipe:null → the launcher
  // shows again) and closes the dock. The decision History (audit log) is kept.
  const resetFilm = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setFilmProgress(null);
    setSelectedEventId(null);
    setPanelAgentId(null);
    stagePrevRef.current = null;
    sessionRef.current = null;
    sessionStateRef.current = null;
    outNodesRef.current = new Map();
    setFilmDockOpen(false);
    onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? {
      ...prev,
      recipe: null, // back to the launcher — "What are we making?"
      genre: null,
      bible: emptyBible(),
      timeline: emptyTimeline(),
      auto: null,
      canvas: { ...(prev.canvas || {}), nodes: [], edges: [] },
    } : prev));
    // No toast — the launcher reappearing is the feedback.
  }, [setNodes, setEdges, onUpdateProject]);

  // Pass tagNode + the heal hook to board AssetNodes through context (functions
  // can't live in serializable node.data).
  // ★ Reference on an audio/video node — tag it CANON so every SHOT card offers it as a
  // one-tap reference chip (untag = toggle off; the flag persists with the project).
  const toggleMediaRef = useCallback((id) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, mediaRef: !n.data.mediaRef } } : n)));
  }, [setNodes]);

  // (The note helpers live earlier — before the context-menu handler that uses them.)

  // The viewed video + the URL the server routes can fetch (local store → loopback-absolute).
  const viewerSrcNode = useCallback(() => nodesRef.current.find((n) => n.id === viewerId && n.data?.kind === 'video'), [viewerId]);

  // 📷 / ⏮ / ⏭ — the playhead (or first/last) frame → a NORMAL image node inside the
  // take's EXTRACTION PANEL (mask/edit/tag/attach all apply). Server ffmpeg, exact,
  // free; the media store checks the data: url into a real file seconds later.
  const viewerExtractFrame = useCallback(async (mode, t = 0) => {
    const node = viewerSrcNode();
    const src = node && absLocalMediaUrl(node.data?.cacheUrl || node.data?.url || '');
    if (!src || viewerBusy) return;
    setViewerBusy(mode);
    try {
      let frameUrl;
      let label;
      if (mode === 'last') {
        const res = await fetch('/api/film/last-frame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src }) });
        const out = await res.json();
        if (!res.ok || !out?.url) throw new Error(out?.details || out?.error || 'No frame came back');
        frameUrl = out.url;
        label = 'Last frame';
      } else {
        const tt = mode === 'first' ? 0 : Math.max(0, Number(t) || 0);
        const res = await fetch('/api/film/frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src, timestamps: [tt] }) });
        const out = await res.json();
        if (!res.ok || !out?.frames?.[0]?.url) throw new Error(out?.details || out?.error || 'No frame came back');
        frameUrl = out.frames[0].url;
        label = mode === 'first' ? 'First frame' : `Frame @ ${tt.toFixed(2)}s`;
      }
      const img = createAssetNode({ kind: 'image', url: frameUrl, label, position: { x: 0, y: 0 }, meta: { takeId: node.id, t: mode === 'last' ? null : (mode === 'first' ? 0 : Number(t) || 0) } });
      addToExtractPanel(node, img);
      Message.success(`${label} in the take's Extracts panel — mask, edit, tag or attach it like any image.`);
    } catch (e) {
      Message.error(`Frame extraction failed: ${e.message}`);
    } finally { setViewerBusy(null); }
  }, [viewerSrcNode, viewerBusy, addToExtractPanel]);

  // 📝 — extract the playhead frame, then ONE explicit Seed 2.0 Pro vision call → the
  // description lands as an editable text NOTE beside the take.
  const viewerDescribe = useCallback(async (t = 0) => {
    const node = viewerSrcNode();
    const src = node && absLocalMediaUrl(node.data?.cacheUrl || node.data?.url || '');
    if (!src || viewerBusy) return;
    if (!apiKey?.trim() && !serverKeyedRef.current) { Message.error('Add your API key first (Project → API key)'); return; }
    setViewerBusy('describe');
    traceRef.current.startRun({ note: 'Agent · Frame describe (Take Viewer)' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
    try {
      const tt = Math.max(0, Number(t) || 0);
      const rf = await fetch('/api/film/frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src, timestamps: [tt] }) });
      const out = await rf.json();
      if (!rf.ok || !out?.frames?.[0]?.url) throw new Error(out?.details || out?.error || 'No frame came back');
      const { text } = await describeFrame({ imageUrl: out.frames[0].url }, ctx);
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Frame @ ${tt.toFixed(2)}s described → note` });
      addToExtractPanel(node, buildNoteNode({ text, label: `@ ${tt.toFixed(2)}s`, meta: { takeId: node.id, t: tt } }));
      Message.success('Frame described — the note is in the take\'s Extracts panel (editable).');
    } catch (e) {
      Message.error(`Describe failed: ${e.message}`);
    } finally { setViewerBusy(null); }
  }, [viewerSrcNode, viewerBusy, apiKey, addToExtractPanel]);

  // 🎧 — the take's audio track → a playable clip node beside it (ffmpeg, free).
  // duration comes from the viewer's <video> metadata — it IS the track's length —
  // so the SHOT-card attach path can show it and warn past Seedance's 15s ref cap.
  const viewerExtractAudio = useCallback(async (duration = 0) => {
    const node = viewerSrcNode();
    const src = node && absLocalMediaUrl(node.data?.cacheUrl || node.data?.url || '');
    if (!src || viewerBusy) return;
    setViewerBusy('audio');
    try {
      const res = await fetch('/api/film/extract-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src }) });
      const out = await res.json();
      if (!res.ok || !out?.url) throw new Error(out?.details || out?.error || 'No audio came back');
      const clip = createAssetNode({ kind: 'audio', url: out.url, label: `${String(node.data?.label || 'Take').slice(0, 32)} · audio`, position: { x: 0, y: 0 }, layerId: 'audio', meta: { takeId: node.id } });
      clip.data.duration = Number(duration) || null;
      addToExtractPanel(node, clip);
      Message.success('Audio track in the take\'s Extracts panel — press play, or ★ it as a SHOT-card reference.');
    } catch (e) {
      Message.error(`Audio extraction failed: ${e.message}`);
    } finally { setViewerBusy(null); }
  }, [viewerSrcNode, viewerBusy, addToExtractPanel]);

  const tagCtx = useMemo(() => ({ onTagRole: tagNode, onRename: renameNode, onImgError: healNodeUrl, onAddToTimeline: addTakeToTimeline, onRemoveFromTimeline: removeTakeFromTimeline, onTimelineIds: onTimelineNodeIds, onEditKeyframe: editKeyframe, onExpandKeyframe: setExpandedKeyframeId, onMaskPrevis: setMaskImgId, onAttachPlate: attachPlateToCard, onCastColors: setPlateCastId, onPromoteKeyframe: promoteKeyframeToCard, onToggleMediaRef: toggleMediaRef, onEditImage: openFrameEditor, onOpenViewer: setViewerId, onPreserve: preserveNodeById, onDuplicate: duplicateNode, onViewImage: setLightboxId, onNeedPoster: ensurePoster, onPromoteMap: promoteMapToCard,
    onRenderStill: (id) => saveKeyframeShot(id, {}), onPatchKeyframeText: patchKeyframeText, onRenderEnd: renderEndOnly, onEnhanceStill: enhanceRowStill, onTagFrame: tagStripStill, onEditEndFrame: setEndEditId, onEditStartFrame: setStartEditId,
    // A demo run is a SHOW — previews beat render savings, so the tile LOD is
    // suspended while it plays (pull-back steps must paint real media, not tiles).
    lod: lodCoarse && !demoOverlay }), [tagNode, renameNode, healNodeUrl, addTakeToTimeline, removeTakeFromTimeline, onTimelineNodeIds, editKeyframe, attachPlateToCard, promoteKeyframeToCard, toggleMediaRef, openFrameEditor, preserveNodeById, saveKeyframeShot, patchKeyframeText, renderEndOnly, enhanceRowStill, tagStripStill, duplicateNode, ensurePoster, promoteMapToCard, lodCoarse, demoOverlay]);

  // The Storyboard chat node runs one brainstorm turn per message, scoped to its own cards.
  // Pool mutations for the chat node's REFS block (SHOT-card-style chips): toggle a bible
  // entry in/out, remove a loose ref, add any board image. Pool order = [Image N] numbering;
  // already-rendered tiles keep their stills — the NEXT turn / render reads the live pool.
  // REMOVING pool entry #removed (0-based) shifts every later [Image N] down by one —
  // already-divided shots must REMAP or their figures silently re-target the wrong
  // plate on the next render. Applied to the chat's shot list AND every card node;
  // a card whose figures/body changed and already has a still goes stale (honest chip).
  const sbApplyPool = useCallback((chatId, refs, removedIndex) => {
    setNodes((ns) => {
      const chat = ns.find((n) => n.id === chatId);
      const panelId = chat?.data?.panelId;
      const remapFigs = (figs) => (Array.isArray(figs) ? figs
        .filter((g) => g !== removedIndex + 1)
        .map((g) => (g > removedIndex + 1 ? g - 1 : g)) : figs);
      const remapBody = (body) => {
        if (removedIndex == null) return body;
        let b = String(body || '');
        // shift [Image k] → [Image k-1] for k > removed (sentinel pass, high→low safe)
        const max = 32;
        for (let k = removedIndex + 2; k <= max; k += 1) b = b.split(`[Image ${k}]`).join(`@@${k - 1}@@`);
        b = b.replace(/@@(\d+)@@/g, '[Image $1]');
        return b;
      };
      const shotChanged = (sh) => {
        if (removedIndex == null) return false;
        const figHit = Array.isArray(sh.figures) && sh.figures.some((g) => g >= removedIndex + 1);
        const bodyHit = [...String(sh.body || '').matchAll(/\[Image (\d+)\]/g)].some((m) => Number(m[1]) >= removedIndex + 1);
        return figHit || bodyHit;
      };
      return ns.map((n) => {
        if (n.id === chatId) {
          const shots = removedIndex == null ? n.data.shots : (n.data.shots || []).map((sh) => (
            shotChanged(sh) ? { ...sh, figures: remapFigs(sh.figures), body: remapBody(sh.body) } : sh));
          return { ...n, data: { ...n.data, refs, shots } };
        }
        if (removedIndex != null && panelId && n.parentId === panelId && n.data?.keyframe) {
          if (!shotChanged(n.data)) return n;
          const hasStill = !!(n.data.url || n.data.cacheUrl);
          return { ...n, data: { ...n.data, figures: remapFigs(n.data.figures), body: remapBody(n.data.body), ...(hasStill ? { staleStill: true } : {}) } };
        }
        return n;
      });
    });
  }, [setNodes]);

  const sbToggleBibleRef = useCallback((chatId, entry) => {
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const pool = (chat?.data?.refs || []).map(poolRef);
    const i = pool.findIndex((r) => (entry.id && r.entryId === entry.id) || r.url === entry.url);
    if (i >= 0) sbApplyPool(chatId, pool.filter((_, j) => j !== i), i);
    else sbApplyPool(chatId, [...pool, { entryId: entry.id, nodeId: entry.nodeId || null, url: entry.url, label: entry.name || 'reference' }], null);
  }, [sbApplyPool]);
  const sbRemoveRef = useCallback((chatId, url) => {
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const pool = (chat?.data?.refs || []).map(poolRef);
    const i = pool.findIndex((r) => r.url === url);
    if (i >= 0) sbApplyPool(chatId, pool.filter((_, j) => j !== i), i);
  }, [sbApplyPool]);
  const sbAddBoardRef = useCallback((chatId, imgNodeId) => addReferenceToPool(chatId, refUrl(nodesRef.current.find((n) => n.id === imgNodeId)) || ''), [addReferenceToPool]);

  // Cast & World FROM the storyboard node (explicit tap on its ✦ chip): drafts anchors
  // from the SAME verbatim script the division reads. Plates land as tagged board
  // panels → their bible chips appear in this node's REFERENCES block to toggle on.
  // PANEL-FIRST, same as the Brief's Storyboard button: the control card's
  // Cast & World button OPENS the agent's rail panel with this
  // storyboard's verbatim script prefilled as the idea — nothing runs on the click;
  // the panel's Run is the explicit tap.
  const castFromStoryboard = useCallback((chatId) => {
    const chat = nodesRef.current.find((n) => n.id === chatId);
    const script = String(chat?.data?.script || '').trim();
    if (!script) { Message.warning('This storyboard carries no script text to cast from.'); return; }
    setLayerSettings((prev) => ({ ...prev, cast: { ...(prev.cast || {}), prompt: script } }));
    setPanelAgentId('cast');
  }, []);

  const sbChatCtx = useMemo(() => ({
    onDivide: runDivide, onListAction: storyboardListAction, bibleEntries, imageAssets,
    onToggleBibleRef: sbToggleBibleRef, onRemoveRef: sbRemoveRef, onAddBoardRef: sbAddBoardRef,
    onRenderAll: renderAllStills, onRenderSheet: renderSheetFromChat, onCastFromScript: castFromStoryboard,
    onPatchChat: (id, patch) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    onOpenRefDrawer: openRefDrawer,
  }), [runDivide, storyboardListAction, bibleEntries, imageAssets, sbToggleBibleRef, sbRemoveRef, sbAddBoardRef, renderAllStills, castFromStoryboard, openRefDrawer]);

  // Handlers only — each Brief node reads its OWN state from node.data and calls these
  // with its id, so one stable context drives every Brief element on the board.
  // Floor plan from a Brief card — the brief rides VERBATIM; the map lands beside.
  const floorPlanFromStory = useCallback((id) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const idea = String(node?.data?.idea || '').trim();
    if (!idea) { Message.warning('Write the brief first.'); return; }
    runFloorPlan({ brief: idea, near: { x: (node.position?.x || 0) + 600, y: node.position?.y || 0 } });
  }, [runFloorPlan]);

  const storyCtx = useMemo(() => ({
    onEditIdea: editStoryIdea,
    onEditPrompt: editStoryPrompt,
    onSetComplexity: setStoryComplexity,
    onDevelop: developStory,
    onCast: draftCastFromStory,
    onStoryboard: storyboardFromStory,
    onFloorPlan: floorPlanFromStory,
    onSplit: splitBriefToShots,
    onSetSplitCount: setStorySplitCount,
    onShoot: shootFilm,
    onClose: removeStoryNode,
  }), [editStoryIdea, editStoryPrompt, setStoryComplexity, developStory, draftCastFromStory, storyboardFromStory, floorPlanFromStory, splitBriefToShots, setStorySplitCount, shootFilm, removeStoryNode]);

  // The drawer's content derives LIVE from the current board/panel state per source,
  // so toggles update badges in place. Bible-tagged images carry their role; other
  // board images land under the Board tab; ★-tagged clips under A/V.
  const refDrawerProps = (() => {
    if (!refDrawer) return null;
    const roleOf = (a) => {
      const b = bibleEntries.find((x) => (x.nodeId && x.nodeId === a.id) || x.url === a.url);
      return b ? b.role : null;
    };
    if (refDrawer.type === 'pick') {
      return {
        title: refDrawer.title, hint: refDrawer.hint, single: true,
        items: refDrawer.items, selection: new Map(),
        onToggle: (item) => { refDrawer.onPick(item); closeRefDrawer(); },
      };
    }
    if (refDrawer.type === 'cut') {
      const node = nodes.find((n) => n.id === refDrawer.id && n.type === 'cut');
      if (!node) return null;
      const d = node.data;
      const refIds = d.refIds || [];
      const assetRefs = d.assetRefs || [];
      const audioRefs = d.audioRefs || (d.audioRef ? [d.audioRef] : []);
      const videoRefs = d.videoRefs || (d.videoRef ? [d.videoRef] : []);
      const sentBibleIds = refIds.filter((rid) => bibleEntries.some((b) => b.id === rid && b.url));
      const selection = new Map();
      sentBibleIds.forEach((rid, i) => selection.set(`bible:${rid}`, String(i + 1)));
      assetRefs.forEach((a, j) => {
        const ia = imageAssets.find((x) => x.id === a.nodeId || x.url === a.url);
        selection.set(`board:${ia ? ia.id : (a.nodeId || a.url)}`, String(sentBibleIds.length + j + 1));
      });
      audioRefs.forEach((a, i) => selection.set(`media:${a.nodeId || a.url}`, `A${i + 1}`));
      videoRefs.forEach((v, i) => selection.set(`media:${v.nodeId || v.url}`, `V${i + 1}`));
      const items = [
        ...bibleEntries.filter((b) => b.url).map((b) => ({ id: `bible:${b.id}`, url: b.url, label: b.name || b.role, role: b.role, kind: 'image', src: b })),
        ...imageAssets.filter((a) => !bibleEntries.some((b) => (b.nodeId && b.nodeId === a.id) || b.url === a.url))
          .map((a) => ({ id: `board:${a.id}`, url: a.url, label: a.label, role: null, kind: 'image', src: a })),
        ...mediaEntries.map((m) => ({ id: `media:${m.nodeId}`, url: m.url, label: m.label, role: null, kind: m.kind, duration: m.duration, src: m })),
      ];
      return {
        title: `SHOT ${(Number(d.cut) || 0) + 1} · references`,
        hint: 'Toggled images ride as [Image 1…N] in pick order; clips attach as reference audio/video.',
        items, selection,
        onToggle: (item) => {
          if (String(item.id).startsWith('bible:')) {
            const eid = item.src.id;
            onPatchCut(refDrawer.id, { refIds: refIds.includes(eid) ? refIds.filter((r) => r !== eid) : [...refIds, eid] });
          } else if (item.kind === 'image') {
            const has = assetRefs.some((a) => a.nodeId === item.src.id || a.url === item.url);
            onPatchCut(refDrawer.id, { assetRefs: has ? assetRefs.filter((a) => !(a.nodeId === item.src.id || a.url === item.url)) : [...assetRefs, { nodeId: item.src.id, url: item.url, label: item.label }] });
          } else if (item.kind === 'audio') {
            const has = audioRefs.some((a) => a.url === item.url);
            onPatchCut(refDrawer.id, { audioRefs: has ? audioRefs.filter((a) => a.url !== item.url) : [...audioRefs, { nodeId: item.src.nodeId, url: item.url, label: item.label, duration: item.duration }], audioRef: null });
          } else {
            const has = videoRefs.some((v) => v.url === item.url);
            onPatchCut(refDrawer.id, { videoRefs: has ? videoRefs.filter((v) => v.url !== item.url) : [...videoRefs, { nodeId: item.src.nodeId, url: item.url, label: item.label }], videoRef: null });
          }
        },
      };
    }
    if (refDrawer.type === 'sbpool') {
      const chat = nodes.find((n) => n.id === refDrawer.id);
      if (!chat) return null;
      const pool = (chat.data?.refs || []).map((r) => (typeof r === 'string' ? { url: r } : (r || {}))).filter((r) => r.url);
      const selection = new Map();
      pool.forEach((r, i) => {
        const b = bibleEntries.find((x) => (r.entryId && x.id === r.entryId) || x.url === r.url);
        if (b) { selection.set(`bible:${b.id}`, String(i + 1)); return; }
        const ia = imageAssets.find((x) => x.id === r.nodeId || x.url === r.url);
        selection.set(`board:${ia ? ia.id : (r.nodeId || r.url)}`, String(i + 1));
      });
      const items = [
        ...bibleEntries.filter((b) => b.url).map((b) => ({ id: `bible:${b.id}`, url: b.url, label: b.name || b.role, role: b.role, kind: 'image', src: b })),
        ...imageAssets.filter((a) => !bibleEntries.some((b) => (b.nodeId && b.nodeId === a.id) || b.url === a.url))
          .map((a) => ({ id: `board:${a.id}`, url: a.url, label: a.label, role: null, kind: 'image', src: a })),
      ];
      return {
        title: 'Storyboard · reference pool',
        hint: 'Pool order IS the [Image N] numbering the division and keyframes use.',
        items, selection,
        onToggle: (item) => {
          if (String(item.id).startsWith('bible:')) { sbToggleBibleRef(refDrawer.id, item.src); return; }
          const inPool = pool.some((r) => r.url === item.url || (r.nodeId && r.nodeId === item.src.id));
          if (inPool) sbRemoveRef(refDrawer.id, item.url); else sbAddBoardRef(refDrawer.id, item.src.id);
        },
      };
    }
    if (refDrawer.type === 'panel') {
      const agentId = selectedAgentNode ? selectedAgentNode.data.agentId : panelAgentId;
      if (!agentId) return null;
      const values = selectedAgentNode
        ? (selectedAgentNode.data.settings || {})
        : { ...(AGENT_MAP[agentId]?.defaultSettings || {}), ...(layerSettings[agentId] || {}) };
      const upd = selectedAgentNode
        ? (patch) => patchAgentSettings(selectedAgentNode.id, patch)
        : (patch) => setLayerSettings((prev) => ({ ...prev, [agentId]: { ...(prev[agentId] || {}), ...patch } }));
      const f = refDrawer.field;
      if (f === 'audioRefs') {
        const picked = values.audioRefs || [];
        return {
          title: 'Voice / sound references', hint: 'Pick order = @Audio1…N in the prompt (up to 3); picking clears the mood image.',
          items: audioAssets.map((a) => ({ id: a.id, url: '', label: a.label, kind: 'audio', duration: a.duration, src: a })),
          selection: new Map(picked.map((rid, i) => [rid, `A${i + 1}`])),
          onToggle: (item) => {
            const on = picked.includes(item.id);
            if (!on && picked.length >= 3) return;
            upd({ audioRefs: on ? picked.filter((x) => x !== item.id) : [...picked, item.id], ...(on ? {} : { imageRef: '' }) });
          },
        };
      }
      const imgItems = imageAssets.map((a) => ({ id: a.id, url: a.url, label: a.label, role: roleOf(a), kind: 'image', src: a }));
      if (f === 'refs') {
        const picked = values.refs || [];
        return {
          title: 'Style references', hint: 'Picked board images seed the storyboard looks.',
          items: imgItems, selection: new Map(picked.map((rid, i) => [rid, String(i + 1)])),
          onToggle: (item) => { const on = picked.includes(item.id); upd({ refs: on ? picked.filter((x) => x !== item.id) : [...picked, item.id] }); },
        };
      }
      // single-pick fields: variations source image / audio mood image
      return {
        title: f === 'anchorId' ? 'Source image' : 'Mood reference', single: true,
        hint: f === 'imageRef' ? 'One board image sets the scene; picking clears the audio references.' : 'One board image is the variation anchor.',
        items: imgItems, selection: new Map(values[f] ? [[values[f], '✓']] : []),
        onToggle: (item) => {
          upd({ [f]: values[f] === item.id ? '' : item.id, ...(f === 'imageRef' ? { audioRefs: [] } : {}) });
          closeRefDrawer();
        },
      };
    }
    return null;
  })();

  return (
    <AssetNodeContext.Provider value={tagCtx}>
    <CutContext.Provider value={cutCtx}>
    <StoryScriptContext.Provider value={storyCtx}>
    <StoryboardChatContext.Provider value={sbChatCtx}>
    <SequenceContext.Provider value={sequenceCtx}>
    <AgentNodeContext.Provider value={agentCtx}>
    <NoteContext.Provider value={noteCtx}>
    <div style={{ display: 'flex', height: '82vh', border: '1px solid #e5e6eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <LayerRail
        activeLayerId={panelAgentId}
        onActivate={handleRailTap}
        visibility={layerVisibility}
        onCycleVisibility={cycleVisibility}
      />

      {libraryOpen && (
        <LibraryPanel
          items={libraryItems}
          onClose={() => setLibraryOpen(false)}
          onRefresh={refreshLibrary}
          onAddToBoard={addLibraryItemToBoard}
          onRemove={deleteLibraryItem}
          onClear={clearLibrary}
        />
      )}

      {historyOpen && (
        <HistoryPanel
          groups={traceGroups}
          actionCount={traceRef.current.entries.length}
          onClose={() => setHistoryOpen(false)}
          onCopy={copyTrace}
          onDownload={downloadTrace}
          onClear={clearTrace}
        />
      )}

      <div ref={wrapperRef} style={{ flex: 1, position: 'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
        {/* Floating toolbar — just the contextual selection action. Add / Library /
            History moved onto the zoom Controls (icon-only); Fit was redundant with the
            Controls' own fit button, so it's gone. Narrow → never crowds the centered
            status pill below. */}
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
          <Space>
            {/* Contextual selection action (appears only with a selection). Lock UI is
                GONE — the bible tag anchors, the per-node cloud tap adds to the Library.
                Delete is keyboard-driven (Backspace/Delete); Space-hold / middle-mouse /
                scroll pans, left-drag marquee-selects. */}
            {selectionCount > 0 && (
              <Tooltip content="Archive selected media to the Library — removes them from the board (bible-tagged stay). Restore any time from the Library.">
                <Button size="small" icon={<IconArchive />} loading={archiving} onClick={archiveSelection} />
              </Tooltip>
            )}
          </Space>
        </div>

        {/* Pipeline STATUS — its own readable top layer (solid pill), so the breadcrumb
            reads cleanly over whatever board content sits behind it. Centered between the
            narrow top-left toolbar and the top-right minimap/Director; the maxWidth caps it
            to a band that clears both (≥250px reserved each side) and scrolls if narrower. */}
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 6, maxWidth: 'min(720px, calc(100% - 500px))', overflowX: 'auto', background: '#fff', border: '1px solid #e5e6eb', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', padding: '6px 14px' }}>
          <PipelineStrip
            hasStory={nodes.some((n) => n.type === 'story' && String(n.data?.idea || '').trim())}
            hasCast={bibleEntries.length > 0}
            hasFilm={!!(timeline.film && timeline.film.url)}
            shots={nodes.filter((n) => n.type === 'cut').length}
            takes={nodes.filter((n) => n.data?.kind === 'video' && String(n.id).startsWith('shot-')).length}
          />
        </div>

        {/* Film mode's conversational director — say it, confirm it, it runs. */}
        {filmMode && filmDockOpen && (
          <FilmDock
            onReset={resetFilm}
            onRoute={routeFilmMessage}
            onDispatch={dispatchFilmAction}
            progress={filmProgress}
          />
        )}
        {filmMode && !filmDockOpen && (
          <Button
            size="small"
            type="primary"
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 8, background: '#b06f10', borderColor: '#b06f10' }}
            onClick={() => setFilmDockOpen(true)}
          >
            🎬 Director
          </Button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          style={{ display: 'none' }}
          onChange={onPickFiles}
        />

        {/* The empty board IS the front door — and the front door IS the Brief: paste
            your words, "Start" lands them VERBATIM as a Brief card (no LLM, no chooser,
            one click). Director chat, blank board and file drops stay one tap away.
            Hidden once anything is on the board (laying the Brief hides it). */}
        {nodes.length === 0 && !filmDockOpen && !project.recipe && !introDismissed ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 6 }}>
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 12, width: 560, maxWidth: 'calc(100% - 32px)', background: '#fff', border: '1px solid #e5e6eb', borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.09)', padding: 22 }}>
              <div>
                <Text style={{ fontSize: 17, fontWeight: 700, display: 'block' }}>Make AI film</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>Your words land on the board exactly as written — everything starts from the Brief.</Text>
              </div>
              <Input.TextArea
                autoFocus
                value={introBrief}
                onChange={setIntroBrief}
                placeholder="Describe your film — one line, a paragraph, or paste a full script. (⌘/Ctrl+Enter to start)"
                autoSize={{ minRows: 4, maxRows: 12 }}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && introBrief.trim()) createStoryNode({ idea: introBrief.trim() }); }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Button type="primary" disabled={!introBrief.trim()} style={{ background: '#b06f10', borderColor: '#b06f10' }} onClick={() => createStoryNode({ idea: introBrief.trim() })}>Start with this brief →</Button>
                <Button type="text" onClick={startShortFilm} style={{ color: '#86909c' }}>🎬 talk to the Director instead</Button>
                <span style={{ flex: 1 }} />
                <Button type="text" size="small" onClick={() => setIntroDismissed(true)} style={{ color: '#86909c' }}>blank board</Button>
              </div>
            </div>
          </div>
        ) : null}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodesDelete={onNodesDeleted}
          onBeforeDelete={onBeforeDelete}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onInit={(inst) => { setRfInstance(inst); rfInstanceRef2.current = inst; }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          // NO onlyRenderVisibleElements: card faces are inert (posters + LOD tiles, no
          // live media), so mounting the whole board ONCE beats viewport culling — culling
          // remounts nodes on every pan across the edge, and a remounted media element
          // re-fetches and re-decodes. Steady DOM, pan/zoom = pure transform.
          fitView
          minZoom={0.1}
          maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']}
          // Left-drag MARQUEE-SELECTS (the editing default). To pan: HOLD SPACE + drag,
          // middle-mouse drag, or trackpad two-finger scroll. Right-click opens the menu;
          // dragging a node still moves the node. (There's no Pan toggle button anymore —
          // the gestures cover it.)
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1]}
          panActivationKeyCode="Space"
          panOnScroll
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onMove={onViewportMove}
          onMoveEnd={recomputeMapNeeded}
          onMoveStart={() => setCtxMenu((m) => (m ? null : m))}
          onPaneContextMenu={openContextMenu}
          onNodeContextMenu={(e) => openContextMenu(e)}
          onSelectionContextMenu={(e) => openContextMenu(e)}
          onPaneClick={() => { setCtxMenu(null); setSelectedEventId(null); }}
        >
          <Background gap={20} />
          {/* Top-left (below the toolbar) so the always-on timeline can't bury the
              zoom / fit / pan-lock buttons. */}
          {/* Zoom / fit Controls, plus the board utilities as icon-only buttons in the
              same stack (Add / Library / History) — no text panel cluttering the rail. */}
          <Controls position="top-left" style={{ top: 50, left: 10 }} showZoom={false} showFitView={false} showInteractive={false}>
            <ControlButton onClick={() => fileInputRef.current?.click()} title="Add assets — images, video or audio">
              <IconPlus style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => rfInstance?.zoomIn({ duration: 200 })} title="Zoom in">
              <IconZoomIn style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => rfInstance?.zoomOut({ duration: 200 })} title="Zoom out">
              <IconZoomOut style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => rfInstance?.fitView({ duration: 300, padding: 0.2 })} title="Fit to view">
              <IconFullscreen style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => setLibraryOpen((v) => !v)} title="Library" style={libraryOpen ? { color: '#165dff' } : undefined}>
              <IconStorage style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => setHistoryOpen((v) => !v)} title="History" style={historyOpen ? { color: '#165dff' } : undefined}>
              <IconHistory style={{ fontSize: 14 }} />
            </ControlButton>
            <ControlButton onClick={() => setTakeLibOpen((v) => !v)} title="Take Library — every card's renders" style={takeLibOpen ? { color: '#165dff' } : undefined}>
              <IconVideoCamera style={{ fontSize: 14 }} />
            </ControlButton>
          </Controls>
          {mapNeeded && <MiniMap position="top-right" pannable zoomable nodeColor={(n) => (n.data?.layerId ? (AGENT_MAP[n.data.layerId]?.color || '#c9cdd4') : '#c9cdd4')} />}
        </ReactFlow>

        {ctxMenu && (
          <CanvasContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            maxHeight={ctxMenu.maxHeight}
            selection={selectedNodes}
            onPick={handleContextPick}
            onAddNote={handleContextAddNote}
            onClose={() => setCtxMenu(null)}
          />
        )}

        {/* The Timeline is the fundamental layer — always on, whatever agent (if
            any) is selected. It's the spine the whole UX hangs on. */}
        <StoryTimeline
          events={timelineEventsView}
          targetSeconds={timeline.targetSeconds}
          film={timeline.film}
          collapsed={timelineCollapsed}
          onToggle={() => setTimelineCollapsed((v) => !v)}
          selectedEventId={selectedEventId || selectedNodes[0]?.id}
          apiKeyPresent={!!apiKey?.trim() || serverKeyed}
          canAddSelected={canAddSelected}
          busy={{ autoFill: autoFillBusy, render: renderBusy }}
          onSelectEvent={selectEventOnBoard}
          onSetDuration={setEventDuration}
          onToggleEventLock={toggleEventLock}
          onMoveEvent={moveEvent}
          onRegenerate={regenerateEvent}
          onRemoveEvent={removeEvent}
          onAddAsset={addAssetToTimeline}
          onAutoFill={handleAutoFill}
          onRenderMovie={handleRenderMovie}
          onAddSelectedToTimeline={addSelectedToTimeline}
          filmMode={filmMode}
        />

        {/* Take Library — an OVERLAY pinned to the wrapper's right edge, deliberately
            NOT a flex sibling: opening it must not resize the canvas (a 300px layout
            shift reads as the camera jumping — the viewport is sacred). */}
        {refDrawerProps && (
          <RefDrawer
            key={`${refDrawer.type}-${refDrawer.id || refDrawer.field || refDrawer.title || ''}`}
            {...refDrawerProps}
            onClose={closeRefDrawer}
          />
        )}
        {takeLibOpen && (
          <TakeLibrary
            groups={takeGroups}
            focusedCardId={takeLibFocusId || focusedCutId}
            timelineIds={onTimelineNodeIds}
            onOpenViewer={setViewerId}
            onAddToTimeline={addTakeToTimeline}
            onRemoveFromTimeline={removeTakeFromTimeline}
            onDeleteTake={deleteTakeById}
            onClearTakes={clearTakes}
            onNeedPoster={ensurePoster}
            onFocusCard={selectAndCenter}
            onShowAll={() => { setTakeLibFocusId(null); setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))); }}
            onClose={() => { setTakeLibFocusId(null); setTakeLibOpen(false); }}
          />
        )}

        {/* Demo replay caption bar — step counter, what's on screen, and the way out. */}
        {demoOverlay && (
          <div style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(15,17,21,0.88)', color: '#fff', borderRadius: 999, padding: '10px 16px', boxShadow: '0 10px 32px rgba(0,0,0,0.35)', maxWidth: 'min(760px, calc(100% - 48px))' }}>
            <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>{demoOverlay.i}/{demoOverlay.n}</span>
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{demoOverlay.caption}</span>
            <Button size="mini" style={{ borderRadius: 999 }} onClick={stopDemo}>Stop</Button>
          </div>
        )}
      </div>

      {(selectedAgentNode || panelAgentId) ? (
        <LayerPanel
          agentId={selectedAgentNode ? selectedAgentNode.data.agentId : panelAgentId}
          values={selectedAgentNode
            ? (selectedAgentNode.data.settings || {})
            : { ...(AGENT_MAP[panelAgentId]?.defaultSettings || {}), ...(layerSettings[panelAgentId] || {}) }}
          onChange={selectedAgentNode
            ? (patch) => patchAgentSettings(selectedAgentNode.id, patch)
            : (patch) => setLayerSettings((prev) => ({ ...prev, [panelAgentId]: { ...(prev[panelAgentId] || {}), ...patch } }))}
          imageAssets={imageAssets}
          audioAssets={audioAssets}
          onOpenRefDrawer={(field) => openRefDrawer({ type: 'panel', field })}
          running={selectedAgentNode ? agentRunning.includes(selectedAgentNode.id) : false}
          draft={!selectedAgentNode}
          onPrimary={selectedAgentNode ? () => runAgentNode(selectedAgentNode.id) : panelPrimary}
          onClose={selectedAgentNode
            ? () => setNodes((ns) => ns.map((n) => (n.id === selectedAgentNode.id ? { ...n, selected: false } : n)))
            : () => { setPanelAgentId(null); panelAtRef.current = null; }}
          apiKeyPresent={!!apiKey?.trim() || serverKeyed}
        />
      ) : null}

      {expandedKeyframeId && (() => {
        const kf = nodes.find((n) => n.id === expandedKeyframeId);
        if (!kf) return null;
        if (kf.data?.keyframe) {
          const chatId = kf.data.panelId ? kf.data.panelId.replace('sbpanel', 'sbchat') : null;
          const chat = chatId && nodes.find((n) => n.id === chatId);
          const pool = chat?.data?.refs?.length ? freshPoolUrls(chat.data.refs) : (bibleRef.current || []).map((e) => e.url).filter(Boolean);
          return (
            <KeyframeEditor
              key={expandedKeyframeId}
              shot={kf.data}
              pool={pool}
              preview={kf.data.cacheUrl || kf.data.localUrl || kf.data.url}
              loading={kf.data.loading}
              imageAssets={imageAssets}
              onClose={() => setExpandedKeyframeId(null)}
              mode="shot"
              onSave={(edits) => saveKeyframeShot(expandedKeyframeId, edits)}
              onSaveText={(edits) => patchKeyframeText(expandedKeyframeId, edits)}
              promptUsed={kf.data.promptUsed}
              onRederive={(figures) => rederiveKeyframeBody(expandedKeyframeId, figures)}
              onAddRef={(url) => addReferenceToPool(chatId, url)}
            />
          );
        }
        // UNIVERSAL: any other board image opens the SAME editor over a LOCAL pool —
        // [Image 1] is the image itself; Regenerate lands a NEW frame beside it.
        const d = kf.data || {};
        const src = d.cacheUrl || d.localUrl || d.url;
        if (d.kind !== 'image' || !src) return null;
        return (
          <KeyframeEditor
            key={expandedKeyframeId}
            shot={{ beat: d.label || 'frame', body: d.editBody || '', shotTemplate: d.editTemplate || 'medium-shot', expression: d.editExpression || '', figures: Array.isArray(d.editFigures) && d.editFigures.length ? d.editFigures : [1] }}
            pool={plainPool}
            preview={src}
            loading={false}
            imageAssets={imageAssets}
            onClose={() => setExpandedKeyframeId(null)}
            onSave={(edits) => regeneratePlainFrame(expandedKeyframeId, edits)}
            onRederive={(figures) => rederivePlainBody(expandedKeyframeId, figures)}
            onAddRef={(url) => { const p = plainPool; if (p.includes(url)) return p.indexOf(url) + 1; setPlainPool([...p, url]); return p.length + 1; }}
          />
        );
      })()}
      {startEditId && (() => {
        const kf = nodes.find((n) => n.id === startEditId);
        const src = kf?.data?.cacheUrl || kf?.data?.url;
        if (!kf || !src) return null;
        const chatId = kf.data.panelId ? String(kf.data.panelId).replace('sbpanel', 'sbchat') : null;
        const chat = chatId && nodes.find((n) => n.id === chatId);
        const pool = [src, ...freshPoolUrls(chat?.data?.refs || [])]; // [1] = the START frame itself
        return (
          <KeyframeEditor
            key={`start-${startEditId}`}
            mode="frame"
            shot={{ beat: `${kf.data.beat || 'Shot'} · START`, body: '', shotTemplate: kf.data.shotTemplate || 'medium-shot', expression: '', figures: [1] }}
            pool={pool}
            preview={src}
            loading={!!kf.data.loading}
            imageAssets={imageAssets}
            onClose={() => setStartEditId(null)}
            onSave={(edits) => applyStartFrameEdit(startEditId, edits)}
            onAddRef={chatId ? (async (url) => { const n = await addReferenceToPool(chatId, url); return n ? n + 1 : null; }) : undefined}
            promptUsed={kf.data.promptUsed}
          />
        );
      })()}
      {endEditId && (() => {
        const kf = nodes.find((n) => n.id === endEditId);
        const src = kf?.data?.endStill?.cacheUrl || kf?.data?.endStill?.url;
        if (!kf || !src) return null;
        const chatId = kf.data.panelId ? String(kf.data.panelId).replace('sbpanel', 'sbchat') : null;
        const chat = chatId && nodes.find((n) => n.id === chatId);
        const pool = [src, ...freshPoolUrls(chat?.data?.refs || [])]; // [1] = the END frame itself
        return (
          <KeyframeEditor
            key={`end-${endEditId}`}
            shot={{ beat: `${kf.data.beat || 'Shot'} · END`, body: '', shotTemplate: kf.data.shotTemplate || 'medium-shot', expression: '', figures: [1] }}
            pool={pool}
            preview={src}
            loading={!!kf.data.endLoading}
            imageAssets={imageAssets}
            mode="frame"
            onClose={() => setEndEditId(null)}
            onSave={(edits) => applyEndFrameEdit(endEditId, edits)}
            promptUsed={kf.data.endStill?.promptUsed}
            onAddRef={chatId ? (async (url) => { const n = await addReferenceToPool(chatId, url); return n ? n + 1 : null; }) : undefined}
          />
        );
      })()}
      {plateCastId && (() => {
        const n = nodes.find((x) => x.id === plateCastId);
        if (!n) return null;
        const src = n.data?.cacheUrl || n.data?.localUrl || n.data?.url; // full-res first — localUrl can be a library THUMB
        const characters = (bibleEntries || []).filter((b) => b.role === 'character' && b.url).map((b) => ({ id: b.id, name: b.name || 'character', url: b.url, nodeId: b.nodeId || null }));
        return (
          <PlateCastEditor
            key={plateCastId}
            src={src}
            colorCast={n.data?.colorCast || {}}
            characters={characters}
            onSave={savePlateCast}
            onClose={() => setPlateCastId(null)}
          />
        );
      })()}
      {viewerId && (() => {
        const n = nodes.find((x) => x.id === viewerId && x.data?.kind === 'video');
        if (!n || !(n.data.cacheUrl || n.data.url)) return null;
        return (
          <TakeViewer
            key={viewerId}
            src={n.data.cacheUrl || n.data.url}
            title={n.data.label || 'Take'}
            busy={viewerBusy}
            onClose={() => { if (!viewerBusy) setViewerId(null); }}
            onExtractFrame={(t) => viewerExtractFrame('frame', t)}
            onFirstFrame={() => viewerExtractFrame('first', 0)}
            onLastFrame={() => viewerExtractFrame('last')}
            onDescribe={viewerDescribe}
            onExtractAudio={viewerExtractAudio}
          />
        );
      })()}
      {/* LIGHTBOX — full-screen image view (dbl-click any image; Esc / click closes). */}
      {lightboxId && (() => {
        const n = nodes.find((x) => x.id === lightboxId);
        const src = n && (n.data?.cacheUrl || n.data?.localUrl || n.data?.url);
        if (!src) return null;
        return (
          <div
            onClick={() => setLightboxId(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(6,8,12,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
          >
            <img src={src} alt={n.data?.label || 'image'} style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', boxShadow: '0 12px 48px rgba(0,0,0,0.6)' }} />
            <div style={{ position: 'fixed', bottom: 14, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: 12, opacity: 0.65, whiteSpace: 'nowrap' }}>
              {String(n.data?.label || '')} — click anywhere or Esc to close
            </div>
          </div>
        );
      })()}
      {maskImgId && (
        <Modal
          visible
          title="Mask — silhouette the figures"
          okText="Generate"
          onOk={runMaskImage}
          onCancel={() => { setMaskImgId(null); setMaskImgPrompt(''); }}
          style={{ width: 520 }}
          unmountOnExit
        >
          <Input.TextArea
            autoFocus
            value={maskImgPrompt}
            onChange={setMaskImgPrompt}
            placeholder="leave empty to mask EVERY person — or say exactly what to mask, word for word: 'only the two standing men', 'the creature and the driver', 'the red car'"
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
            The masked subjects become flat color silhouettes (blue, green, yellow, red, purple — left to right); everything else stays identical. The plate lands as a NEW image beside this one.
          </Text>
        </Modal>
      )}
    </div>
    </NoteContext.Provider>
    </AgentNodeContext.Provider>
    </SequenceContext.Provider>
    </StoryboardChatContext.Provider>
    </StoryScriptContext.Provider>
    </CutContext.Provider>
    </AssetNodeContext.Provider>
  );
};

const FilmCanvas = (props) => (
  <ReactFlowProvider>
    <FilmCanvasInner {...props} />
  </ReactFlowProvider>
);

export default FilmCanvas;
