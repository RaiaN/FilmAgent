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
import { Button, Message, Space, Typography, Tooltip, Modal, InputNumber } from '@arco-design/web-react';
import {
  IconLock,
  IconUnlock,
  IconRefresh,
  IconPlus,
  IconZoomIn,
  IconZoomOut,
  IconFullscreen,
  IconStorage,
  IconHistory,
} from '@arco-design/web-react/icon';
import AssetNode, { AssetNodeContext } from './AssetNode';
import CutNode, { CutContext } from './CutNode';
import GroupNode from './GroupNode';
import StoryScriptNode, { StoryScriptContext } from './StoryScriptNode';
import LayerRail from './LayerRail';
import LayerPanel from './LayerPanel';
import CanvasContextMenu from './CanvasContextMenu';
import LibraryPanel from './LibraryPanel';
import StoryTimeline from './StoryTimeline';
import FilmDock from './FilmDock';
import PipelineStrip from './PipelineStrip';
import HistoryPanel from './HistoryPanel';
import { AGENT_MAP, AGENTS, castAgent, createBrowserTransport, classifyAssets } from '../../../utils/film/agents';
import { createProduction, runStep as runAgentOp } from '../../../utils/film/core/production';
import { animate as animateOp } from '../../../utils/film/core/operations';
import { detectGenre, writeFilmPrompt, deconstructTake, generateStoryboard } from '../../../utils/film/core/storyboard';
import { pipelineStatus } from '../../../utils/film/pipeline';
import { routeStudioAction } from '../../../utils/film/core/director';
import { createBrowserClient } from '../../../utils/film/core/client';
import { createTrace } from '../../../utils/film/core/trace';
import { emptyTimeline, emptyBible, eventsFromStoryNodes } from '../../../utils/film/projectShape';
import { bibleEntry, timelineEvent, orderedEvents, renumber, mirrorSessionEvents, resolveBibleUrls } from '../../../utils/film/timelineModel';
import { BIBLE_ROLES, SHORT_FILM_RECIPE, composeFilmShotPrompt, shotReferences, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
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
import { cacheAssetLocal } from '../../../utils/film/assetCache';

const { Text } = Typography;

const nodeTypes = { asset: AssetNode, group: GroupNode, cut: CutNode, story: StoryScriptNode };

// Agents that can fill a selected timeline clip directly (image agents → the clip's
// keyframe; animate → its rendered shot).
const CLIP_FILLABLE = new Set(['inspiration', 'characterVariations', 'locationVariations', 'animate']);

const CELL_W = 240;
const CELL_H = 290;
const GROUP_PAD = 12;
const GROUP_HEADER = 34;

// SHOT cards are 300px wide and TALL — the prompt + cinematography + audio + params +
// references run ~600–700px. Tile on a generous pitch so rows never collide.
const CUT_COL_W = 340;
const CUT_ROW_H = 760;
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
// Storyboard panel grid: one ROW per shot, the shot's frames left-to-right (a cell each).

// A top-level node's bounding box for collision-aware placement. React Flow's
// measured dims when it has them; type-based fallbacks for nodes added this tick
// (not yet measured). Children (parentId) live inside groups — callers exclude them.
const NODE_FALLBACK = {
  cut: { w: 300, h: CUT_ROW_H },
  group: { w: 280, h: 220 },
  story: { w: 1000, h: 420 }, // wide horizontal layout — beats laid left-to-right
  image: { w: 220, h: 280 },
  video: { w: 220, h: 240 },
  audio: { w: 220, h: 120 },
  text: { w: 280, h: 200 },
};
const nodeRect = (n) => {
  const key = n.type === 'cut' || n.type === 'group' ? n.type : (n.data?.kind || 'image');
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
const refUrl = (n) => n?.data?.localUrl || n?.data?.url;

// Shrink a fat base64 reference so several bible refs don't blow the
// /api/film/imagine 20mb body limit (the suspected "empty shots" cause: uploaded
// bible anchors are multi-MB base64). http(s) URLs pass through untouched — the
// server inlines those itself — so only big data: URLs are downscaled (~1024px JPEG).
const REF_DOWNSCALE_OVER = 700 * 1024; // ~0.7MB of base64 ≈ a >0.5MB source image
const downscaleRef = async (url) => {
  if (typeof url !== 'string' || !url.startsWith('data:') || url.length < REF_DOWNSCALE_OVER) return url;
  try { return await makeThumbnail(url, 1024); } catch { return url; }
};

// Back-compat: a modal-era project persisted project.bible.entries but its board
// nodes aren't tagged. Stamp role + lock onto each entry's source node (or, if that
// node is gone, synthesize a tagged node from the entry) so reconcileBibleFromNodes
// derives the same bible — nodes are now the source of truth. Idempotent: skips an
// entry whose node is already tagged, so it's safe to run on every load.
const seedBibleTags = (nodes, entries) => {
  if (!entries || !entries.length) return nodes;
  const list = nodes.slice();
  const indexById = new Map(list.map((n, i) => [n.id, i]));
  entries.forEach((e) => {
    const synthId = `bibnode-${e.id}`;
    const tagged = list.some((n) => n.data?.bibleRole && (n.id === e.nodeId || n.id === synthId));
    if (tagged) return;
    if (e.nodeId && indexById.has(e.nodeId)) {
      const i = indexById.get(e.nodeId);
      list[i] = { ...list[i], data: { ...list[i].data, bibleRole: e.role, locked: true } };
    } else if (e.url && !indexById.has(synthId)) {
      const node = createAssetNode({ id: synthId, kind: 'image', url: e.url, label: e.name || e.role, position: { x: 60 + (list.length % 6) * 200, y: 20 }, locked: true, preserved: true });
      node.data.bibleRole = e.role;
      list.push(node);
      indexById.set(synthId, list.length - 1);
    }
  });
  return list;
};

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
  let droppedRefs = 0;
  const maxTries = urls.length + 2;
  for (let t = 0; t < maxTries; t += 1) {
    try {
      const out = await animateOp({ // eslint-disable-line no-await-in-loop
        motion: shot.motion, camera: 'auto', refUrls: urls, refAssetIds: ids,
        firstFrameUrl: shot.firstFrameUrl, duration: shot.durationSec, resolution: shot.resolution, ratio: shot.ratio,
        generateAudio: genAudio, seed: shot.seed,
      }, ctx);
      return { taskId: out.taskId, droppedRefs };
    } catch (e) {
      const m = e?.message || '';
      if (/output audio may contain sensitive/i.test(m) && genAudio) { genAudio = false; continue; }
      const i = inputScreened(m) ? refIndexOf(m) : -1;
      if (i >= 0 && i < urls.length) { urls.splice(i, 1); ids.splice(i, 1); droppedRefs += 1; continue; }
      throw e;
    }
  }
  throw new Error('The video model rejected every reference image as sensitive — try non-photoreal plates or fewer refs.');
};

const FilmCanvasInner = ({ project, apiKey, onUpdateProject }) => {
  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);

  const initialLayerState = useMemo(() => buildInitialLayerState(project), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layerSettings, setLayerSettings] = useState(initialLayerState.settings);
  const [layerVisibility, setLayerVisibility] = useState(initialLayerState.visibility);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    // Seed bible tags from any persisted entries up front (first mount skips the
    // project-switch effect below), so the reconciler derives the same bible.
    seedBibleTags(applyVisibility(project.canvas?.nodes || [], initialLayerState.visibility), project.bible?.entries || []),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(project.canvas?.edges || []);

  // Arrive QUIET — no agent panel until the user picks one from the rail. The front
  // door is the template launcher + conversational docks, not an auto-opened panel.
  const [activeLayerId, setActiveLayerId] = useState(null);
  // Layer ids currently running — PER-AGENT, so a long agent (e.g. Storyboard) never
  // blocks Running another (e.g. Location Variations). The Run button gates on its own id.
  const [runningAgents, setRunningAgents] = useState([]);
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

  // ---- the SEQUENCE seed — one seed for every shot (the iteration lever) ----
  // locked: reuse `value` across re-shoots (a prompt tweak is then the ONLY changed
  // variable); unlocked: re-roll each shoot. value null = let the model choose.
  const [seed, setSeed] = useState(() => {
    const s = project.seed;
    return (s && typeof s === 'object') ? { value: s.value ?? null, locked: !!s.locked } : { value: null, locked: false };
  });
  const seedRef = useRef(seed);
  useEffect(() => { seedRef.current = seed; }, [seed]);
  const shootSeedRef = useRef(null); // the exact seed a shoot used (threaded into shotFromCard)
  // True while a CUT shoot (🎬 / Action) is running: those dock the take UNDER its card
  // (upsertShotNodeForCard), so the generic session→board reconcile must NOT also drop a
  // loose copy (that was the "two videos per shot" / un-attached-shot bug).
  const cutShootActiveRef = useRef(false);
  // Persist seed changes onto the project (so a reload keeps the locked sequence seed).
  useEffect(() => {
    onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, seed } : prev));
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const rollSeed = () => Math.floor(Math.random() * 2147483647);
  // The seed a shoot should use: a locked value rides every shot unchanged; otherwise
  // roll a fresh one (and surface it in the control, so a good random can then be locked).
  const resolveShootSeed = useCallback(() => {
    const s = seedRef.current || { value: null, locked: false };
    if (s.locked && s.value != null) return s.value;
    const value = rollSeed();
    setSeed((prev) => ({ ...prev, value }));
    return value;
  }, []);

  // ---- the spine: timeline + bible (single source of truth = the project) ----
  const timeline = useMemo(() => project.timeline || emptyTimeline(), [project.timeline]);
  const bible = useMemo(() => project.bible || emptyBible(), [project.bible]);
  const timelineEvents = useMemo(() => orderedEvents(timeline.events || []), [timeline.events]);
  // Which board take nodes are currently ON the timeline (drives the Take node's button).
  const onTimelineNodeIds = useMemo(() => new Set((timelineEvents || []).map((e) => e.shotNodeId).filter(Boolean)), [timelineEvents]);
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
  // on seeding (below) so a freshly-loaded project whose entries aren't yet stamped
  // onto nodes isn't wiped before seedBibleTags runs.
  const bibleSeededRef = useRef(project.id); // armed once a project's entries are seeded onto nodes (first mount seeds in useNodesState)
  useEffect(() => {
    if (bibleSeededRef.current !== project.id) return;
    const derived = nodes
      .filter((n) => n.data?.bibleRole && n.data?.locked && n.data?.kind === 'image' && (n.data?.bibleRefUrl || n.data?.localUrl || n.data?.url))
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

  // Auto-cache to LOCAL storage: an image/video rides an EXPIRING remote URL (Seedream) or, for
  // a Deconstruct key frame, a MEGABYTE inline base64 `data:` url. Fetch the bytes ONCE into the
  // project's own assets/ folder and stamp `data.cacheUrl` (a stable same-origin url the board
  // renders from) — the canvas survives reload / expiry / offline and stays self-contained.
  //   • remote http url → KEEP `data.url` (the model paths still need a public url to register).
  //   • data: url (a frame) → REPLACE `data.url` with the cacheUrl too, dropping the base64 —
  //     cuts GPU/memory (a real file decodes once + evicts) AND project.json bloat; the shoot
  //     then registers the cacheUrl via registerShotRefs.
  // Best-effort; each node cached once (guard ref); runs in the background as assets land.
  const assetCacheRef = useRef({}); // nodeId -> true once handled (in-flight or done/failed)
  useEffect(() => {
    const pid = project.id;
    if (!pid) return;
    const targets = nodes.filter((n) =>
      (n.data?.kind === 'image' || n.data?.kind === 'video')
      && !n.data?.cacheUrl
      && !assetCacheRef.current[n.id]
      && typeof n.data?.url === 'string' && /^(https?:\/\/|data:)/.test(n.data.url));
    if (!targets.length) return;
    targets.forEach((n) => { assetCacheRef.current[n.id] = true; });
    (async () => {
      for (const n of targets) {
        const wasData = n.data.url.startsWith('data:');
        const local = await cacheAssetLocal({ id: pid, url: n.data.url }); // eslint-disable-line no-await-in-loop
        if (local) setNodes((ns) => ns.map((m) => (m.id === n.id ? { ...m, data: { ...m.data, cacheUrl: local, ...(wasData ? { url: local } : {}) } } : m)));
      }
    })();
  }, [nodes, project.id, setNodes]);

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
    // Seed bible tags onto nodes BEFORE arming the reconciler so a persisted (modal-era)
    // bible isn't derived-to-empty on the first pass. After this, tagged nodes drive it.
    setNodes(seedBibleTags(applyVisibility(project.canvas?.nodes || [], ls.visibility), project.bible?.entries || []));
    bibleSeededRef.current = project.id;
    sessionRef.current = null;
    setFilmProgress(null);
    assetCacheRef.current = {}; // per-project: forget which nodes were locally cached
    outNodesRef.current = new Map();
    traceRef.current.clear(); // the run log belongs to one project's session
    sessionStateRef.current = project.auto || null;
    // Silently rehydrate the cached production session so per-shot iteration
    // (regenerate-with-note) survives a reload — no panel, the timeline is the surface.
    if (project.auto && (project.auto.plan || project.auto.steps || []).length && apiKey?.trim()) {
      buildSession([], project.auto);
    }
    // Every project opens quiet — agents are picked from the rail, not auto-armed.
    setActiveLayerId(null);
    setSelectedEventId(null);
    setTimelineCollapsed(!(project.timeline?.events?.length));
    // Bring any Story Director beats onto the spine for a project that predates the
    // timeline (one-time; persisted events take precedence so this never duplicates).
    if (!(project.timeline?.events || []).length) {
      const migrated = eventsFromStoryNodes(project.canvas?.nodes || []);
      if (migrated.length) updateTimeline((cur) => ({ ...cur, events: migrated }));
    }
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push canvas + layer state up to the parent (which debounce-persists to disk).
  useEffect(() => {
    const handle = setTimeout(() => {
      onUpdateProject((prev) => {
        if (!prev || prev.id !== loadedIdRef.current) return prev;
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
          canvas: { nodes: serializeNodes(nodes), edges, viewport: prev.canvas?.viewport || null },
          layers,
          auto: sessionStateRef.current, // cached session snapshot for reload (no UI)
        };
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [nodes, edges, layerSettings, layerVisibility]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

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
      const { url, assetId } = await stageLocalAsset(dataUrl, name);
      setNodes((ns) => ns.map((n) => (n.id === nodeId
        // localUrl = the original bytes: drives the thumbnail AND is the Seedream
        //   reference (the TOS url isn't publicly fetchable, so we never feed it
        //   to a reference fetch). tosUrl + assetId are the Seedance/Animate path.
        ? { ...n, data: { ...n.data, url, tosUrl: url, localUrl: dataUrl, assetId, staged: true, loading: false } }
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
      try {
        const dataUrl = await readFileAsDataUrl(file); // eslint-disable-line no-await-in-loop
        const node = createAssetNode({
          kind,
          url: kind === 'text' ? '' : dataUrl,
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
    if (!node || node.data?.kind !== 'image' || !node.data?.url) return node?.data?.url;
    if (node.data?.preserved) return node.data.url;
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, preserving: true } } : n)));
    try {
      const { url: stableUrl, assetId, objectKey } = await preserveAsset(node.data.url, node.data.label);
      setNodes((ns) => ns.map((n) => (n.id === node.id
        ? { ...n, data: { ...n.data, url: stableUrl, tosUrl: stableUrl, assetId, objectKey, preserved: true, preserving: false, expired: false } }
        : n)));
      addToLibrary({ url: stableUrl, assetId, name: node.data.label || 'Asset', kind: 'image' })
        .then((items) => setLibraryItems(items))
        .catch(() => { /* non-fatal */ });
      return stableUrl;
    } catch (err) {
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, preserving: false } } : n)));
      throw err;
    }
  }, [setNodes]);

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
      ? { ...n, data: { ...n.data, bibleRole: role || null, locked: !!role } }
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

  // "Build brand kit": classify the board's UNTAGGED image nodes into AD roles and
  // tag each (role + lock) → they flow into project.bible via the reconciler.
  const classifyBoardAssets = useCallback(async () => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return []; }
    const targets = nodesRef.current.filter((n) => n.data?.kind === 'image' && (n.data?.localUrl || n.data?.url)
      && !n.data?.bibleRole && !n.id.startsWith('shot-') && !n.id.startsWith('film-'));
    if (!targets.length) { Message.warning('No untagged board images to sort — drop a few brand assets on the board first.'); return []; }
    const images = targets.map(refUrl).filter(Boolean);
    traceRef.current.startRun({ note: 'Build brand kit' });
    const rec = traceRef.current.log({ kind: 'bible.classify', note: `${images.length} board image${images.length === 1 ? '' : 's'}`, status: 'running' });
    try {
      const { assets } = await classifyAssets({ apiKey: apiKey.trim(), client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())), images, idea: '', roles: BIBLE_ROLES, requiredRoles: ['character', 'location'] });
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


  // ---- selection actions ----
  const setLockOnSelection = useCallback((locked) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, locked } } : n)));
    if (locked) {
      // Locking marks an asset canonical → preserve it so references never expire.
      const toPreserve = nodes.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url && !n.data?.preserved);
      toPreserve.forEach((n) => { preserveNode(n).catch((e) => Message.warning(`Preserve failed: ${e.message}`)); });
    }
  }, [setNodes, nodes, preserveNode]);

  // Delete is keyboard-driven (deleteKeyCode) — ReactFlow removes the node AND its
  // children (xyflow v12 cascades parentId) and hands us the full set here, so the
  // Final Cut timeline drops any clip that referenced a deleted take/keyframe.
  const onNodesDeleted = useCallback((deleted) => {
    const ids = new Set((deleted || []).map((n) => n.id));
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !ids.has(e.shotNodeId) && !ids.has(e.keyframeNodeId)) }));
  }, [updateTimeline]);

  // ---- layers ----
  const cycleVisibility = useCallback((layerId) => {
    setLayerVisibility((prev) => {
      const next = { ...prev, [layerId]: VIS_CYCLE[prev[layerId] || 'show'] };
      setNodes((ns) => applyVisibility(ns, next));
      return next;
    });
  }, [setNodes]);

  const activeSettings = layerSettings[activeLayerId] || {};
  const setActiveSettings = useCallback((next) => {
    setLayerSettings((prev) => ({ ...prev, [activeLayerId]: next }));
  }, [activeLayerId]);

  // Run any agent programmatically and collect what it produced. Used by the
  // manual Run button AND the Auto Director executor. Resolves once the agent's
  // run() returns (sync outputs already on the board); `done` resolves later when
  // async (video) assets finish, so callers that need final URLs can await it.
  // Storyboard panels → CUT cards. The card-laying logic lives with the other cut
  // handlers further down (it needs syncCutEdges); the ref bridges the ordering.
  const storyboardPanelRef = useRef(null);

  // The Cast & World rail agent streams plates via onPlan/onEntry (not the rail's
  // onAsset), so its rail Run routes through the same castDraft path the strip/chat
  // use. The handler is defined far below (it needs genre detection + plate laying);
  // this ref bridges the ordering so handleRun can call it.
  const castRunRef = useRef(null);
  // Same bridge for the Story rail agent (createStoryNode + runStory live far below).
  const storyRunRef = useRef(null);
  // …and for Deconstruct (handleBreakdownTake lives far below). `deconstructing` = the
  // take id currently being deconstructed (drives the Take node's button spinner).
  const deconstructRunRef = useRef(null);
  const [deconstructing, setDeconstructing] = useState(null);
  // …and for the Storyboard agent (handleGenerateStoryboard lives far below).
  const storyboardRunRef = useRef(null);

  // Snap a batch's origin to open board space so successive runs (and a batch vs.
  // whatever is already there) never pile onto the same spot — the overlap bug.
  // Reads live nodes, so it sees everything placed so far this session.
  const freeOrigin = useCallback(({ w, h, preferred }) => {
    const rects = nodesRef.current.filter((n) => !n.parentId).map(nodeRect);
    return findFreeOrigin({ rects, w, h, preferred });
  }, []);

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
        return {
          position: { x: GROUP_PAD + (i % groupCols) * CELL_W, y: GROUP_HEADER + Math.floor(i / groupCols) * cellH },
          parentId: groupId,
          extent: 'parent',
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
        extent: 'parent',
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
          ? { ...n, data: { ...n.data, loading: false, label: 'Animation failed', error: message } }
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

  // ---- clip-scoped agent runs (agents = tools that fill timeline chunks) -------
  // Drop / reuse a board node for a clip's keyframe (image) or shot (video), so the
  // result is also on the board — draggable, bible-able, and centerable from the clip.
  const upsertClipNode = useCallback((existingId, idx, { kind, url, label }) => {
    if (existingId && nodesRef.current.some((n) => n.id === existingId)) {
      setNodes((ns) => ns.map((n) => (n.id === existingId ? { ...n, data: { ...n.data, kind, url, label } } : n)));
      return existingId;
    }
    const o = rfInstance ? rfInstance.screenToFlowPosition({ x: 120, y: 120 }) : { x: 120, y: 120 };
    const node = createAssetNode({ kind, url, label, position: { x: o.x + (idx % 4) * 260, y: o.y + Math.floor(idx / 4) * 300 } });
    setNodes((ns) => ns.concat(node));
    return node.id;
  }, [rfInstance, setNodes]);

  const setClipFields = useCallback((id, patch) => {
    updateTimeline((cur) => ({ ...cur, events: (cur.events || []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }, [updateTimeline]);

  // The rail agent fills the SELECTED clip: image agents → its keyframe (from the
  // clip's beat + bible + any selected board refs); Animate → its rendered shot.
  // Reuses the engine's single-agent primitive (runAgentOp) so behavior matches Auto-fill.
  const fillClipWithAgent = useCallback(async (event, agentId, settings) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    traceRef.current.startRun({ note: `Fill clip · ${event.beat || 'shot'} (${agentId})` });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
    const idx = Math.max(0, timelineEvents.findIndex((e) => e.id === event.id));
    const boardUrls = nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url).map(refUrl).filter(Boolean);
    const refs = [...new Set([...boardUrls, ...resolveBibleUrls(event.bibleRefs, bibleRef.current, 4)])];

    if (agentId === 'animate') {
      if (!event.keyframeUrl) { Message.warning('This clip has no keyframe yet — fill it with Inspiration first.'); return; }
      setClipFields(event.id, { status: 'rendering' });
      try {
        const outs = await runAgentOp({ agent: 'animate', params: { ...settings, motion: settings.motion || event.beat, duration: event.durationSec }, inputUrls: [event.keyframeUrl], count: 1, intent: event.beat }, ctx);
        if (!outs[0]?.url) throw new Error('Animate produced no shot');
        const nodeId = upsertClipNode(event.shotNodeId, idx, { kind: 'video', url: outs[0].url, label: `Shot · ${event.beat || 'clip'}` });
        setClipFields(event.id, { shotUrl: outs[0].url, shotNodeId: nodeId, status: 'shot' });
        Message.success('Shot rendered');
      } catch (err) {
        Message.error(err.message);
        setClipFields(event.id, { status: 'keyframe' });
      }
      return;
    }

    if ((agentId === 'characterVariations' || agentId === 'locationVariations') && !refs.length) { Message.warning('Select a reference image on the board (or add a bible anchor) for variations.'); return; }
    setClipFields(event.id, { status: 'rendering' });
    try {
      // The clip's BEAT is the prompt (that's the shot description) — it wins over the
      // panel's idea-seeded prompt. prompt feeds inspiration; direction feeds the
      // variations agents. Bible = the look.
      // planTask 'adShot': a clip fill is production work — preserve the refs' identity
      // (only the freeform board Run keeps the exploratory planner persona).
      const params = { ...settings, prompt: event.beat || settings.prompt, direction: event.beat || settings.direction || settings.prompt, planTask: 'adShot' };
      const outs = await runAgentOp({ agent: agentId, params, inputUrls: refs, count: 1, intent: event.beat }, ctx);
      if (!outs[0]?.url) throw new Error('No keyframe generated');
      const nodeId = upsertClipNode(event.keyframeNodeId, idx, { kind: 'image', url: outs[0].url, label: `Keyframe · ${event.beat || 'clip'}` });
      setClipFields(event.id, { keyframeUrl: outs[0].url, keyframeNodeId: nodeId, status: 'keyframe' });
      Message.success(`Keyframe filled for clip ${idx + 1}`);
    } catch (err) {
      Message.error(err.message);
      setClipFields(event.id, { status: event.keyframeUrl ? 'keyframe' : 'empty' });
    }
  }, [apiKey, timelineEvents, upsertClipNode, setClipFields]);

  const handleRun = useCallback(async () => {
    const lid = activeLayerId;
    const layer = AGENT_MAP[lid];
    if (!layer) return;
    const clip = timelineEvents.find((e) => e.id === selectedEventId);
    setRunningAgents((r) => (r.includes(lid) ? r : [...r, lid]));
    try {
      // A timeline clip is selected → the agent fills THAT clip. Otherwise the
      // classic board run (generate cards from the board selection).
      if (clip && CLIP_FILLABLE.has(activeLayerId)) {
        await fillClipWithAgent(clip, activeLayerId, activeSettings);
      } else if (activeLayerId === 'cast') {
        // Cast & World streams plates via the castDraft path (genre gate + plate
        // laying + the auto look board) — the typed idea wins, else the project's.
        const idea = (activeSettings.prompt || '').trim();
        if (!idea) { Message.warning('Type the film idea first — one sentence is enough.'); return; }
        if (castRunRef.current) await castRunRef.current(idea);
        Message.success('Cast & World drafted and auto-tagged into the bible');
      } else if (activeLayerId === 'story') {
        // Story writes from the IDEA alone — it does NOT pull the board's reference
        // assets in. Drops a NEW editable Story card and writes the cinematic prompt into it.
        const idea = (activeSettings.prompt || '').trim();
        if (!idea) { Message.warning('Type the film idea first — one sentence is enough.'); return; }
        if (storyRunRef.current) storyRunRef.current(idea);
        Message.success('Story drafted — cinematic prompt on the board');
      } else if (activeLayerId === 'deconstruct') {
        // Deconstruct operates on a SELECTED Take (a rendered video) → its cuts.
        const take = nodes.find((n) => n.selected && n.data?.kind === 'video' && n.data?.url);
        if (!take) { Message.warning('Select a Take (a rendered video) on the board first.'); return; }
        if (deconstructRunRef.current) await deconstructRunRef.current(take.id);
      } else if (activeLayerId === 'storyboard') {
        // Storyboard a typed idea, else the SELECTED Story node (no fallback to a random
        // story). Any SELECTED board images ride as references on every frame.
        const idea = (activeSettings.prompt || '').trim();
        const selStory = nodes.find((n) => n.type === 'story' && n.selected && n.data?.prompt);
        if (!idea && !selStory) { Message.warning('Select a Story node on the board (or type an idea), then Run.'); return; }
        const refs = nodes.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url).map((n) => n.data.localUrl || n.data.url);
        if (storyboardRunRef.current) await storyboardRunRef.current(idea ? { story: idea, references: refs, count: activeSettings.count } : { id: selStory.id, references: refs, count: activeSettings.count });
      } else {
        const selNodes = nodes.filter((n) => n.selected);
        const origin = originOverride.current || undefined;
        originOverride.current = null;
        const { result } = await runAgent({ agentId: activeLayerId, settings: activeSettings, selectionNodes: selNodes, origin });
        Message.success(result?.async
          ? `${layer.label} started — the shot is cooking on the board`
          : `${layer.label} finished`);
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setRunningAgents((r) => r.filter((x) => x !== lid));
    }
  }, [activeLayerId, activeSettings, nodes, runAgent, timelineEvents, selectedEventId, fillClipWithAgent]);

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
    const transport = createBrowserTransport(apiKey.trim());
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
  // "Make the ad" no longer fires generation — it LAYS OUT one CUT card per beat on
  // the board (content + camera/motion + duration + asset edges); the user refines
  // them, shoots any single card with its 🎬, and "🎬 Action" shoots the rest.

  // Dashed prerequisite edges into the card: bible refs (via their board nodes) AND
  // per-cut attached board assets.
  const syncCutEdges = useCallback((cutId, refIds, assetRefs) => {
    setEdges((es) => {
      const kept = es.filter((e) => !(String(e.id).startsWith('cutedge-') && e.target === cutId));
      const style = { stroke: '#f7ba1e', strokeDasharray: '4 3', opacity: 0.55 };
      const fromBible = (refIds || []).map((rid) => {
        const ent = bibleRef.current.find((b) => b.id === rid);
        return ent && ent.nodeId ? { id: `cutedge-${cutId}-${rid}`, source: ent.nodeId, target: cutId, style } : null;
      });
      const fromAssets = (assetRefs || []).map((a) => (
        a.nodeId && nodesRef.current.some((n) => n.id === a.nodeId)
          ? { id: `cutedge-${cutId}-${a.nodeId}`, source: a.nodeId, target: cutId, style }
          : null
      ));
      return [...kept, ...[...fromBible, ...fromAssets].filter(Boolean)];
    });
  }, [setEdges]);

  const onPatchCut = useCallback((id, p) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)));
    if (p.refIds || p.assetRefs) {
      const cur = nodesRef.current.find((n) => n.id === id)?.data || {};
      syncCutEdges(id, p.refIds || cur.refIds, p.assetRefs || cur.assetRefs);
    }
  }, [setNodes, syncCutEdges]);

  // Attach one asset (a board node drop, or a Library item) to a cut. Bible-tagged
  // nodes toggle their entry on; anything else becomes a per-cut assetRef. This is
  // the route fresh agent variations take into a shot — and it stays curate-first:
  // attaching feeds ONE cut, it does not canonize into the bible.
  const attachRefToCut = useCallback((cutId, payload) => {
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card || !payload?.url) return;
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
  }, [onPatchCut]);

  // "+ board selection" on the card: feed every selected board image to this cut.
  const attachSelectedToCut = useCallback((cutId) => {
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card) return;
    const sel = nodesRef.current.filter((n) => n.selected && n.type !== 'cut' && n.data?.kind === 'image' && (n.data?.url || n.data?.localUrl));
    if (!sel.length) { Message.warning('Select one or more board images first, then click + board selection'); return; }
    const refIds = [...(card.data.refIds || [])];
    const assetRefs = [...(card.data.assetRefs || [])];
    let added = 0;
    sel.forEach((n) => {
      const url = refUrl(n);
      if (!url) return;
      const ent = bibleRef.current.find((b) => b.nodeId === n.id) || bibleRef.current.find((b) => b.url === url);
      if (ent) {
        if (!refIds.includes(ent.id)) { refIds.push(ent.id); added += 1; }
      } else if (!assetRefs.some((a) => a.url === url)) {
        assetRefs.push({ nodeId: n.id, url, label: n.data?.label || 'asset' });
        added += 1;
      }
    });
    if (!added) { Message.info('Those assets already feed this cut'); return; }
    onPatchCut(cutId, { refIds, assetRefs });
    Message.success(`${added} asset${added === 1 ? '' : 's'} now feeding CUT ${(card.data.cut ?? 0) + 1}`);
  }, [onPatchCut]);

  // Lay ONE panel as a SHOT card — the Story's prompt rides verbatim as promptOverride.
  storyboardPanelRef.current = (panel, base) => {
    if (!panel || !base) return;
    // idPrefix lets a parallel generator lay 'cut' cards with distinct ids so they don't
    // collide with — or get pruned alongside — the Story's cut-N (default prefix 'cut').
    const id = `${panel.idPrefix || 'cut'}-${panel.index}`;
    const sec = Math.min(15, Math.max(5, panel.durationSec || 10));
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
    setNodes((ns) => {
      if (ns.some((n) => n.id === id)) {
        // Re-derive → refresh content from the new panel, KEEP the take + asset attachments.
        return ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...derived } } : n));
      }
      const card = {
        id,
        type: 'cut',
        position: { x: base.x + (panel.index % 3) * CUT_COL_W, y: base.y + Math.floor(panel.index / 3) * CUT_ROW_H },
        data: { cut: panel.cut ?? panel.index, ...derived, assetRefs: [] },
      };
      return [...ns, card];
    });
    syncCutEdges(id, panel.refEntryIds || [], []);
  };

  // A SHOT card → one blueprint shot: the Story's prompt (verbatim, + camera/look/audio)
  // and the card's REAL refs go straight to Seedance, in [Image1..N] order. keepTake
  // carries an existing take along so Action doesn't re-shoot it.
  const shotFromCard = useCallback((c, { keepTake = true, continuityFrameUrl = null } = {}) => {
    const refEntryIds = [...(c.data.refIds || []), ...(c.data.assetRefs || []).map(extRefId)];
    const baseRefs = shotReferences(c.data, bibleRef.current);
    // CONTINUITY: the previous shot's FINAL FRAME rides as an ADDITIONAL reference image
    // (Seedance forbids first_frame + reference media together), appended LAST.
    const references = continuityFrameUrl
      ? [...baseRefs, { url: continuityFrameUrl, desc: 'previous shot — final frame (continuity reference)', assetId: null }]
      : baseRefs;
    const motion = composeFilmShotPrompt({ prompt: c.data.promptOverride || '', shotTemplate: c.data.shotTemplate || '', cinematography: c.data.cinematography || '', audio: c.data.audio || '' });
    return {
      beat: c.data.beat,
      direct: true,
      motion,
      camera: 'auto',
      durationSec: Math.min(15, Math.max(5, Math.round(Number(c.data.durationSec) || 10))),
      refEntryIds,
      refUrls: references.map((r) => r.url),
      // Parallel to refUrls: a registered portrait-library id (or null) per ref, so the
      // shoot sends person/place plates as image_asset_id (trusted) instead of a screened url.
      refAssetIds: references.map((r) => r.assetId || null),
      firstFrameUrl: null,
      // Standard Seedance 2.0 params edited on the card (fall back to engine defaults).
      resolution: c.data.resolution,
      ratio: c.data.ratio,
      generateAudio: c.data.generateAudio,
      // The card's own seed wins; else the sequence seed this shoot resolved.
      seed: c.data.seed ?? shootSeedRef.current,
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
        if (hit.kind === 'anim' && e.kind === 'video') { onPatchCut(hit.cardId, { shotUrl: e.url, status: 'shot' }); upsertShotNodeForCard(hit.cardId, e.url); }
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
      && (/^https?:\/\//.test(e.url) || e.url.startsWith('/api/film/asset')));
    for (const e of targets) {
      try {
        const isCache = e.url.startsWith('/api/film/asset');
        const src = isCache && typeof window !== 'undefined' ? `${window.location.origin}${e.url}` : e.url;
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
      // A local-cache ref (a cached Deconstruct frame, `/api/film/asset?…`) is same-origin —
      // make it absolute so the preserve server can fetch the file (loopback) → TOS asset. Raw
      // http refs preserve directly; asset:// / data: are handled downstream.
      const u = url.startsWith('/api/film/asset') && typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;
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
  const handleShootCut = useCallback(async (cutId) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card) return;
    const seed = resolveShootSeed();
    // Continuity (best-effort): the nearest earlier shot card's final frame.
    const prevShot = nodesRef.current
      .filter((n) => n.type === 'cut' && n.data?.shotUrl && (n.data?.cut ?? 0) < (card.data?.cut ?? 0))
      .sort((a, b) => (b.data?.cut ?? 0) - (a.data?.cut ?? 0))[0];
    let continuityFrameUrl = prevShot?.data?.lastFrameUrl || null;
    if (!continuityFrameUrl && prevShot?.data?.shotUrl) {
      try { continuityFrameUrl = (await createBrowserTransport(apiKey.trim()).lastFrame(prevShot.data.shotUrl)).url || null; } catch { /* best-effort */ }
    }
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
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
    // Fire-and-forget so the 🎬 button NEVER blocks — every click is an independent take.
    (async () => {
      try {
        await ensureRefsRegistered(card);
        const shot = shotFromCard({ ...card, data: { ...card.data, seed: card.data.seed ?? seed } }, { keepTake: false, continuityFrameUrl });
        const refAssetIds = await registerShotRefs(shot.refUrls, shot.refAssetIds);
        // Seedance content-SCREENS every reference image and rejects any it judges to "contain
        // sensitive information / a real person" — photoreal cast plates trip it EVEN as fully
        // registered asset:// refs (this endpoint has no consented-identity bypass). It reports
        // the FIRST offender as `content[N].image_url`; so DROP that ref and retry, looping
        // until the take renders. Report how many refs the screen skipped (consistency hit).
        const { taskId, droppedRefs } = await animateWithRefFallback(shot, refAssetIds, ctx);
        if (droppedRefs) Message.warning(`${droppedRefs} reference image${droppedRefs === 1 ? '' : 's'} skipped on take ${takeNo} — the video model's content screen flagged ${droppedRefs === 1 ? 'it' : 'them'} as sensitive (this take is less anchored).`);
        const { videoUrl, lastFrameUrl } = await ctx.client.pollVideo({ taskId });
        setNodes((ns) => ns.map((n) => (n.id === takeId ? { ...n, data: { ...n.data, url: videoUrl, loading: false, label: `Take ${takeNo}` } } : n)));
        onPatchCut(cutId, { status: 'shot', shotUrl: videoUrl, lastFrameUrl: lastFrameUrl || null });
      } catch (err) {
        setNodes((ns) => ns.map((n) => (n.id === takeId ? { ...n, data: { ...n.data, loading: false, error: err.message, label: 'Take failed' } } : n)));
        Message.error(`Shot failed: ${err.message}`);
      }
    })();
  }, [apiKey, shotFromCard, onPatchCut, resolveShootSeed, setNodes, ensureRefsRegistered, registerShotRefs]);

  // DECONSTRUCT a Take → its cuts. Seed 2.0 Pro WATCHES the video; we grab the key frames
  // it points at (visual-grounding ingredients, as board images) and lay one editable SHOT
  // card per cut (camera + cinematography pre-filled, references LEFT EMPTY for the user to
  // populate). The bridge from a quick Exploration Take to detailed, directed shots.
  const handleBreakdownTake = useCallback(async (takeId) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    const take = nodesRef.current.find((n) => n.id === takeId && n.data?.kind === 'video' && n.data?.url);
    if (!take) { Message.error('Pick a finished Take (a rendered video) first'); return; }
    // The source SHOT card = the take's grid's card (grid-<cutId> → <cutId>) — its prompt
    // is context for the read.
    const cutId = take.parentId ? String(take.parentId).replace(/^grid-/, '') : null;
    const card = cutId ? nodesRef.current.find((n) => n.id === cutId && n.type === 'cut') : null;
    const sourcePrompt = card?.data?.promptOverride || card?.data?.beat || '';
    const genre = projectRef.current?.genre?.line || '';
    setDeconstructing(takeId);
    traceRef.current.startRun({ note: 'Agent · Deconstruct' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
    try {
      const bible = bibleRef.current.filter((b) => b.url).map((b) => ({ name: b.name, role: b.role }));
      const { cuts } = await deconstructTake({ videoUrl: take.data.url, prompt: sourcePrompt, genre, bible }, ctx);
      // Grab every key frame the VLM pointed at (server ffmpeg → base64), keyed by ~second.
      const allTs = [...new Set(cuts.flatMap((c) => c.keyTimestamps).map((t) => Math.round(t * 10) / 10))];
      let frames = [];
      if (allTs.length) { try { frames = await createBrowserTransport(apiKey.trim()).frames(take.data.url, allTs); } catch { /* frames best-effort */ } }
      const frameUrlAt = (t) => { const f = frames.find((x) => Math.abs(x.t - t) < 0.3); return f ? f.url : null; };
      // Lay the output below the take: a key-frame strip on top, the per-cut SHOT cards under.
      const pref = rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 520 }) : { x: 220, y: 520 };
      const origin = freeOrigin({ w: 3 * CUT_COL_W, h: PLATE_ROW_H + 2 * CUT_ROW_H, preferred: pref });
      let kf = 0;
      cuts.forEach((c) => {
        c.keyTimestamps.forEach((t) => {
          const url = frameUrlAt(Math.round(t * 10) / 10);
          if (!url) return;
          const node = createAssetNode({ kind: 'image', url, label: `Cut ${c.index + 1} · ${t}s`, position: { x: origin.x + kf * PLATE_COL_W, y: origin.y }, locked: true });
          node.data.bibleRole = 'frame'; // a deconstructed key frame IS a Frame → tag it so it lands as a referenceable bible asset
          setNodes((ns) => ns.concat(node));
          kf += 1;
        });
      });
      const cardBase = { x: origin.x, y: origin.y + PLATE_ROW_H + 30 };
      cuts.forEach((c) => {
        if (!storyboardPanelRef.current) return;
        storyboardPanelRef.current({
          index: c.index, idPrefix: `dx-${takeId}`, title: `Cut ${c.index + 1}`,
          action: c.action, promptOverride: c.action, framing: '',
          shotTemplate: c.shotTemplate || 'medium-shot', cinematography: c.cinematography,
          durationSec: 15, refEntryIds: [], audio: '', rederive: true,
        }, cardBase);
      });
      Message.success(`Deconstructed into ${cuts.length} cut${cuts.length === 1 ? '' : 's'} — key frames + SHOT cards on the board (populate refs, then 🎬).`);
    } catch (e) { Message.error(`Deconstruct failed: ${e.message}`); }
    finally { setDeconstructing(null); }
  }, [apiKey, rfInstance, freeOrigin, setNodes]);

  // 🎬 Action: shoot the SHOT cards IN ORDER, CONTINUITY-CHAINED — each shot rides the
  // previous shot's FINAL FRAME (extracted via the last-frame API) as a reference + a
  // CONTINUITY note, so the world, lighting, character design and screen direction carry
  // over and four clips become a sequence. This forces SEQUENTIAL shooting (shot N+1 needs
  // shot N's last frame), so it trades the old parallel batch for a coherent chain. Cards
  // already shot keep their take and still seed the next shot's continuity. No auto-stitch
  // (you assemble when it reads right — ▶ / Stitch).
  const handleAction = useCallback(async () => {
    const cards = nodesRef.current.filter((n) => n.type === 'cut').sort((a, b) => (a.data?.cut ?? 0) - (b.data?.cut ?? 0));
    if (!cards.length) { Message.warning('No SHOT cards on the board — break the story into shots first.'); return; }
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    const oldStepIds = new Set(cards.map((c) => c.data?.lastAnimStepId).filter(Boolean));
    if (oldStepIds.size) updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !oldStepIds.has(e.stepId)) }));
    const kept = cards.filter((c) => c.data?.shotUrl).length;
    shootSeedRef.current = resolveShootSeed(); // one sequence seed across the whole chain
    traceRef.current.startRun({ note: `Action · ${cards.length} shots, continuity-chained${kept ? ` (${kept} kept)` : ''}` });
    setTimelineCollapsed(false);
    setAutoFillBusy(true);
    cutShootActiveRef.current = true; // dock-only: suppress the loose session→board copy
    const transport = createBrowserTransport(apiKey.trim());
    const lastFrameOf = async (url) => { try { return (await transport.lastFrame(url)).url || null; } catch { return null; } };
    let prevFrameUrl = null;  // the previous shot's final frame (continuity anchor)
    let failures = 0;
    try {
      for (const card of cards) {
        // Already shot & kept → don't re-shoot, but use it as the continuity anchor
        // (its stored native last frame, else extract one).
        if (card.data?.shotUrl) {
          prevFrameUrl = card.data.lastFrameUrl || (await lastFrameOf(card.data.shotUrl)) || prevFrameUrl;
          continue;
        }
        // Register any photoreal cast plate refs as trusted assets (dodges the real-person filter).
        await ensureRefsRegistered(card);
        const shot = shotFromCard({ ...card, data: { ...card.data } }, { keepTake: false, continuityFrameUrl: prevFrameUrl });
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
          onPatchCut(card.id, { status: 'shot', shotUrl, lastFrameUrl });
          upsertShotNodeForCard(card.id, shotUrl);
          prevFrameUrl = lastFrameUrl || prevFrameUrl; // anchor for the NEXT shot (keep last good on failure)
        } else {
          onPatchCut(card.id, { status: 'failed' });
          failures += 1;
        }
      }
      Message.success(`Shots are in, chained in order${failures ? ` (${failures} failed — re-shoot those)` : ''}. Press ▶ / Stitch to assemble the cut.`);
    } finally {
      setAutoFillBusy(false);
      cutShootActiveRef.current = false;
    }
  }, [apiKey, buildSession, shotFromCard, wireCutSession, onPatchCut, updateTimeline, resolveShootSeed, upsertShotNodeForCard, ensureRefsRegistered, registerShotRefs]);

  // The card context: patching, shooting and attaching.
  const cutCtx = useMemo(() => ({
    onPatchCut,
    bibleEntries,
    onShootCut: handleShootCut,
    onAttachSelected: attachSelectedToCut,
    onAttachAsset: attachRefToCut,
  }), [onPatchCut, bibleEntries, handleShootCut, attachSelectedToCut, attachRefToCut]);

  const filmMode = true; // Short-Film-only suite (ad mode purged).

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
    setActiveLayerId(null);
    setFilmDockOpen(true);
  }, [onUpdateProject]);

  // The pipeline read FRESH from refs — used by routing context and the
  // deterministic "continue" ladder, so neither can drift from the board.
  const livePipeline = useCallback(() => pipelineStatus({
    idea: nodesRef.current.find((n) => n.type === 'story' && n.data?.idea)?.data?.idea || '',
    storyPrompt: nodesRef.current.find((n) => n.type === 'story' && n.data?.prompt)?.data?.prompt || '',
    bibleEntries: bibleRef.current,
    cutCards: nodesRef.current.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
    filmUrl: projectRef.current?.timeline?.film?.url || '',
    candidates: nodesRef.current.filter((n) => n.data?.kind === 'image' && !n.data?.bibleRole).length,
  }), []);

  // Route one chat message → ONE studio action (LLM interprets, traced; the user
  // confirms in the dock; dispatch below is deterministic).
  const routeFilmMessage = useCallback(async (message) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return null; }
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
      const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
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


  // ---- Story (idea/script → one cinematic prompt → New Shot) ----------------
  const storyClient = useCallback(() => ({ client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) }), [apiKey]);

  // A Story lives ON THE BOARD as a node — an editable script card you iterate on BEFORE
  // any pixels; it reads its own state from node.data. createStoryNode ALWAYS lays a fresh
  // one (the rail/chat spawn a new Story each time) and returns its id so runStory can
  // target it; the node's own Rewrite re-runs that node.
  const createStoryNode = useCallback(({ idea = '' } = {}) => {
    const id = `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setNodes((ns) => {
      const preferred = rfInstance ? rfInstance.screenToFlowPosition({ x: 260, y: 200 }) : { x: 160, y: 160 };
      const position = freeOrigin({ w: 1000, h: 420, preferred }); // wide node — beats laid left-to-right
      return ns.concat({ id, type: 'story', position, data: { idea, mode: '', prompt: '', complexity: 'medium', busy: false, shooting: false, phase: 'idle' } });
    });
    return id;
  }, [setNodes, rfInstance, freeOrigin]);

  const removeStoryNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, [setNodes]);

  // The Story agent: an idea OR a pasted script → ONE long cinematic prompt, at the chosen
  // rewrite DEPTH (light | medium | deep — the node's toggle). Writes into THIS node's data;
  // node.data persists with the board, so a reload keeps the story.
  const runStory = useCallback(async ({ id, idea, source = '' }) => {
    const data = nodesRef.current.find((n) => n.id === id)?.data || {};
    const complexity = data.complexity || 'medium';
    traceRef.current.startRun({ note: 'Agent · Story' });
    patchStoryNode(id, (d) => ({ idea: idea ?? d.idea, busy: true, phase: 'writing' }));
    try {
      const { mode, prompt } = await writeFilmPrompt({ idea, source, complexity }, storyClient());
      traceRef.current.log({ level: 'run', kind: 'decision', note: `Story · ${prompt.length}-char prompt (${mode}, ${complexity})` });
      patchStoryNode(id, (d) => ({ idea: idea ?? d.idea, mode, prompt, busy: false, phase: 'ready' }));
    } catch (e) { Message.error(`Story failed: ${e.message}`); patchStoryNode(id, (d) => ({ busy: false, phase: d.prompt ? 'ready' : 'idle' })); }
  }, [storyClient, patchStoryNode]);

  // Rewrite from scratch (fresh from this node's idea).
  const regenerateStory = useCallback((id) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    if (d.busy || d.shooting) return;
    runStory({ id, idea: d.idea || '', source: '' });
  }, [runStory]);

  // Paste your OWN story/script → preserved (rewritten cinematically, not into a new story).
  const shapeStorySource = useCallback((id, text) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    if (d.busy || !String(text || '').trim()) return;
    runStory({ id, idea: d.idea || '', source: text });
  }, [runStory]);

  // Manual edit of the cinematic prompt (what New Shot puts on the card).
  const editStoryPrompt = useCallback((id, text) => patchStoryNode(id, { prompt: text }), [patchStoryNode]);

  // Rewrite DEPTH (light | medium | deep) — the next Rewrite of this node uses it.
  const setStoryComplexity = useCallback((id, complexity) => patchStoryNode(id, { complexity }), [patchStoryNode]);

  // Cast & World from this Story node → draft the characters/locations/look from its idea
  // (the same castDraft path as the rail/chat; plates land tagged on the board). The node's
  // button spins via a transient `casting` flag while the draft runs.
  const draftCastFromStory = useCallback(async (id) => {
    const d = nodesRef.current.find((n) => n.id === id)?.data || {};
    const idea = (d.idea || d.prompt || '').trim();
    if (!idea) { Message.warning('Write the story (or give it an idea) first — Cast & World needs a premise.'); return; }
    if (!castRunRef.current) return;
    patchStoryNode(id, { casting: true });
    try { await castRunRef.current(idea); }
    finally { patchStoryNode(id, { casting: false }); }
  }, [patchStoryNode]);

  // New Shot → lay an editable SHOT card (CutNode) on the board, pre-filled with the Story's
  // cinematic prompt + a default camera. The user edits the prompt / camera / SD params on
  // the card, then 🎬 on the card shoots it. Re-clicking re-derives the same card.
  const shootFilm = useCallback((id) => {
    const storyNode = nodesRef.current.find((n) => n.id === id && n.type === 'story');
    const prompt = String(storyNode?.data?.prompt || '').trim();
    if (!prompt) { Message.warning('Write the story first — there is no prompt to shoot.'); return; }
    if (!storyboardPanelRef.current) return;
    // Land the SHOT card NEXT TO this Story node (to its right); fall back to a screen spot.
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
      action: prompt, promptOverride: prompt, framing: '', shotTemplate: 'medium-shot', durationSec: 15,
      refEntryIds: [], audio: '',
    }, base);
    Message.success('SHOT card on the board — edit the prompt, camera and SD params, then 🎬 to shoot.');
  }, [rfInstance, freeOrigin]);

  // 📋 Storyboard → a visual storyboard PANEL on the board: one Seedream frame per story
  // element (CUT-marked), rendered SEQUENTIALLY so each frame uses the previous as a visual
  // reference + one shared seed. Reached from the rail Storyboard agent + the Director chat.
  // Targets a Story node: explicit `id`, else a typed `story` idea (standalone), else the
  // SELECTED story — NO recency fallback, so with nothing selected it just doesn't run. Each
  // story gets its OWN panel (keyed by id). `references` (rail) or SELECTED images anchor frames.
  const handleGenerateStoryboard = useCallback(async ({ id, story, references, count } = {}) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    const stories = nodesRef.current.filter((n) => n.type === 'story');
    // Work on the SELECTED Story node only — no recency fallback. An explicit `id` (or a
    // typed `story` idea) overrides; otherwise nothing happens unless a story is selected.
    const node = id ? stories.find((n) => n.id === id)
      : (story ? null // a typed idea (rail) storyboards standalone — not bound to a node
        : (stories.find((n) => n.selected) || null));
    const targetId = node?.id || null;
    const text = String(story || node?.data?.prompt || '').trim();
    if (!text) { Message.warning('Select the Story node you want to storyboard (or type an idea), then run.'); return; }
    // References: the explicitly-passed refs (rail) or the currently-selected board images
    // (select your Cast & World plates first to anchor every frame on them).
    const refs = (references && references.length)
      ? references
      : nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url).map((n) => n.data.localUrl || n.data.url);
    const PANEL_ID = `storyboard-${targetId || 'panel'}`;
    const COLS = 5;
    traceRef.current.startRun({ note: 'Agent · Storyboard' });
    const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
    // Land the panel below its Story node when known, else a screen spot.
    const pref = node ? { x: node.position?.x || 0, y: (node.position?.y || 0) + 480 } : (rfInstance ? rfInstance.screenToFlowPosition({ x: 320, y: 560 }) : { x: 220, y: 560 });
    const base = freeOrigin({ w: GROUP_PAD * 2 + COLS * PLATE_COL_W, h: GROUP_HEADER + GROUP_PAD + PLATE_ROW_H, preferred: pref });
    try {
      await generateStoryboard({ story: text, references: refs, count }, ctx, {
        onPlan: (els) => {
          setNodes((ns) => {
            // Replace this story's prior storyboard panel + its frames (others untouched).
            let next = ns.filter((n) => n.id !== PANEL_ID && n.parentId !== PANEL_ID);
            const rows = Math.max(1, Math.ceil(els.length / COLS));
            const grid = createGroupNode({ label: 'Storyboard', position: base, width: GROUP_PAD * 2 + COLS * PLATE_COL_W, height: GROUP_HEADER + GROUP_PAD + rows * PLATE_ROW_H });
            next = next.concat({ ...grid, id: PANEL_ID }); // parent before children (RF ordering)
            els.forEach((el) => {
              const fn = createAssetNode({ kind: 'image', url: '', label: `Frame ${el.index + 1}`, position: { x: GROUP_PAD + (el.index % COLS) * PLATE_COL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(el.index / COLS) * PLATE_ROW_H } });
              next = next.concat({ ...fn, id: `${PANEL_ID}-f${el.index}`, parentId: PANEL_ID, data: { ...fn.data, loading: true } });
            });
            return next;
          });
        },
        onFrame: ({ index, url, error }) => {
          setNodes((ns) => ns.map((n) => (n.id === `${PANEL_ID}-f${index}` ? { ...n, data: { ...n.data, url: url || n.data.url, loading: false, ...(error ? { error } : {}) } } : n)));
        },
      });
      Message.success('Storyboard generated');
    } catch (e) { Message.error(`Storyboard failed: ${e.message}`); }
  }, [apiKey, rfInstance, freeOrigin, setNodes]);



  // Deterministic dispatch of a CONFIRMED chat action to the existing machinery.
  // Returns the chat's reply line.
  const dispatchFilmAction = useCallback(async (action, params = {}) => {
    const selImages = nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    // When an agent runs with no explicit premise, fall back to the SELECTED Story node's idea.
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
        // Story is IDEA-first — it writes the cinematic prompt from the premise. Each ask
        // spawns a NEW Story node; the card appearing IS the feedback.
        const ideaText = (params.prompt || '').trim();
        if (!ideaText) return 'Tell me what the film is about — one sentence is enough.';
        const sid = createStoryNode({ idea: ideaText });
        runStory({ id: sid, idea: ideaText });
        return '';
      }
      case 'storyboard': {
        const sel = nodesRef.current.find((n) => n.type === 'story' && n.selected && n.data?.prompt);
        if (!sel) return 'Select the Story node you want to storyboard (one with a written prompt) — I work on the selected story.';
        if (storyboardRunRef.current) storyboardRunRef.current({ id: sel.id });
        return '';
      }
      case 'deconstruct': {
        const take = nodesRef.current.find((n) => n.selected && n.data?.kind === 'video' && n.data?.url);
        if (!take) return 'Select a Take (a rendered video) on the board first, then I\'ll break it into its cuts.';
        if (deconstructRunRef.current) deconstructRunRef.current(take.id);
        return '';
      }
      case 'detectGenre': {
        // The genre detector: read genre & tone from the premise FIRST, surface it
        // as one-tap chips. Picking a chip locks the genre and runs castDraft — so
        // the highest-leverage creative call is made (and steerable) before any spend.
        const idea = (params.prompt || selStoryIdea()).trim();
        if (!idea) return 'Give me the film idea (or select a Story node) first — one sentence is enough.';
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
        if (!idea) return 'Give me the film idea (or select a Story node) first — one sentence is enough.';
        traceRef.current.startRun({ note: `Agent · ${castAgent.label}` });
        const castCtx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
        // Genre = the picked chip, else the project's, else a quick read (strip path).
        let genre = (params.genre || '').trim() || (projectRef.current?.genre?.line || '');
        if (!genre) { const g = await detectGenre({ idea }, castCtx); genre = [g.genre, g.tone].filter(Boolean).join(' · '); }
        onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, genre: { line: genre } } : prev));
        pushFilmNote(`Drafting as ${genre} — characters, places and a look render into the Cast & World panel below.`);
        // Lay a "Cast & World" PANEL — a group node that holds every plate as it renders, so
        // the board shows ONE in-progress container (all pending spinners together) instead of
        // loose loading cards. Unique id per draft → a re-draft makes a fresh panel in open space.
        const PANEL_ID = `cast-${Date.now().toString(36)}`;
        const CAST_COLS = 4;
        const preferred = rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 180 }) : { x: 120, y: 120 };
        const slotPos = (i) => ({ x: GROUP_PAD + (i % CAST_COLS) * PLATE_COL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(i / CAST_COLS) * PLATE_ROW_H });
        const slotIds = []; // plan index → child node id, so each plate fills its own cell
        const { created: entries } = await castAgent.run({
          prompt: idea, settings: { genre }, ctx: castCtx,
          // onPlan: lay the panel + a LOADING cell per planned plate the instant the read
          // returns, so the whole pending block shows at once (no silent minute). AUTO-TAG:
          // stamp bibleRole + locked NOW — the draft IS the bible (children are still picked
          // up by the reconciler regardless of the panel parent).
          onPlan: (specs) => {
            const rows = Math.max(1, Math.ceil(specs.length / CAST_COLS));
            const w = GROUP_PAD * 2 + CAST_COLS * PLATE_COL_W;
            const h = GROUP_HEADER + GROUP_PAD + rows * PLATE_ROW_H;
            const base = freeOrigin({ w, h, preferred });
            setNodes((ns) => {
              const grid = createGroupNode({ label: 'Cast & World', position: base, width: w, height: h });
              let next = ns.concat({ ...grid, id: PANEL_ID }); // parent BEFORE children (RF ordering)
              specs.forEach((s, i) => {
                const node = createAssetNode({ kind: 'image', url: '', label: s.name, position: slotPos(i), layerId: 'cast' });
                node.data.loading = true;
                node.data.bibleRole = s.role;
                node.data.locked = true;
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
            if (id) {
              setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url: c.url, loading: false } } : n)));
            } else {
              const node = createAssetNode({ kind: 'image', url: c.url, label: c.name, position: slotPos(i), layerId: 'cast' });
              node.data.bibleRole = c.role; node.data.locked = true;
              setNodes((ns) => ns.concat({ ...node, parentId: PANEL_ID }));
            }
          },
        });
        return `${entries.length} cast & world asset${entries.length === 1 ? '' : 's'} drafted and auto-tagged into the bible — the pipeline strip moved forward. Re-roll any you don't like with Character / Location Variations, then write the story.`;
      }
      case 'action': {
        if (!nodesRef.current.some((n) => n.type === 'cut')) return 'No cards to shoot yet — write a story, then New Shot on the Story node drops a SHOT card.';
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
            return 'First I need the premise — one sentence: what is this film about?';
          case 'casting':
            return {
              say: `Next is casting & world (${next.note}). I can draft the whole production from the idea — characters, places and a look, all in one shared style; you tag the keepers.`,
              next: { action: 'castDraft', say: 'Draft the production' },
            };
          case 'storyboard':
            return {
              say: 'Next is the story: I shape your idea (or your own script) into ONE long cinematic prompt — all editable. New Shot on the Story node turns it into a SHOT card.',
              next: { action: 'story', say: 'Write the story' },
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
  }, [runAgent, nodesForRole, classifyBoardAssets, handleAction, apiKey, onUpdateProject, rfInstance, setNodes, livePipeline, pushFilmNote, freeOrigin, runStory, createStoryNode]);

  // handleRenderMovie is declared below (it reads live timeline state); the
  // dispatch above reaches it through this ref to avoid a declaration-order knot.
  const renderMovieRef = useRef(null);

  // The Cast & World rail agent's Run reuses the castDraft dispatch (declared just
  // above) — same genre gate, plate streaming and auto look board as the strip/chat,
  // so the rail trigger behaves identically. Bridged via the ref declared up top.
  castRunRef.current = (idea) => dispatchFilmAction('castDraft', { prompt: idea });

  // The Story rail agent's Run: spawn a NEW editable Story card, then write the cinematic
  // prompt into it from the idea (board refs stay opt-in — runStory does not feed the bible in).
  storyRunRef.current = (idea) => { const t = (idea || '').trim(); const sid = createStoryNode({ idea: t }); runStory({ id: sid, idea: t }); };
  deconstructRunRef.current = (takeId) => handleBreakdownTake(takeId);
  storyboardRunRef.current = (opts) => handleGenerateStoryboard(opts);

  // Render movie: stitch the timeline's rendered shots IN EVENT ORDER (so reorders
  // and trims are honored) into the final cut — same server ffmpeg + TOS as the engine.
  const handleRenderMovie = useCallback(async () => {
    const shots = orderedEvents(timelineEvents).filter((e) => e.shotUrl).map((e) => e.shotUrl);
    if (!shots.length) { Message.warning('No rendered shots yet — Auto-fill or animate the keyframes first.'); return; }
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    setRenderBusy(true);
    try {
      const out = await createBrowserTransport(apiKey.trim()).stitch(shots, { name: (project.title || 'film').slice(0, 40) });
      updateTimeline((cur) => ({ ...cur, film: { url: out.url, assetId: out.assetId || null, builtAt: new Date().toISOString() } }));
      Message.success('Final cut assembled');
    } catch (err) {
      Message.error(`Render failed: ${err.message}`);
    } finally {
      setRenderBusy(false);
    }
  }, [timelineEvents, apiKey, project.title, updateTimeline]);
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
  // DETACH a take from its ShotGrid: drag a take video out past the grid's edge and it
  // pops out as a standalone node (absolute position), then the grid re-packs the takes
  // that remain and shrinks — or vanishes if that was the last one. Drag a take WITHIN the
  // grid and parenting is left alone (it just moves to a free slot visually).
  const handleNodeDragStop = useCallback((_e, node) => {
    if (!node?.parentId || !String(node.id).startsWith('shot-')) return;
    const gridId = node.parentId;
    setNodes((ns) => {
      const grid = ns.find((n) => n.id === gridId);
      if (!grid) return ns;
      const gridW = grid.style?.width || GROUP_PAD * 2 + TAKE_COLS * CELL_W;
      const gridH = grid.style?.height || GROUP_HEADER + GROUP_PAD + TAKE_CELL_H;
      const cx = (node.position?.x || 0) + CELL_W / 2;
      const cy = (node.position?.y || 0) + TAKE_CELL_H / 2;
      if (cx >= 0 && cx <= gridW && cy >= 0 && cy <= gridH) return ns; // still inside
      const abs = { x: (grid.position?.x || 0) + (node.position?.x || 0), y: (grid.position?.y || 0) + (node.position?.y || 0) };
      const next = ns.map((n) => (n.id === node.id ? { ...n, parentId: undefined, extent: undefined, position: abs } : n));
      const rest = next.filter((n) => n.parentId === gridId).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
      if (!rest.length) return next.filter((n) => n.id !== gridId); // grid emptied → drop it
      const packed = new Map(rest.map((n, i) => [n.id, { x: GROUP_PAD + (i % TAKE_COLS) * CELL_W, y: GROUP_HEADER + GROUP_PAD + Math.floor(i / TAKE_COLS) * TAKE_CELL_H }]));
      const w = GROUP_PAD * 2 + TAKE_COLS * CELL_W;
      const h = GROUP_HEADER + GROUP_PAD + (Math.floor((rest.length - 1) / TAKE_COLS) + 1) * TAKE_CELL_H;
      return next.map((n) => {
        if (packed.has(n.id)) return { ...n, position: packed.get(n.id) };
        if (n.id === gridId) return { ...n, style: { ...n.style, width: w, height: h } };
        return n;
      });
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

  const handleContextPick = useCallback((layerId) => {
    setCtxMenu(null);
    setActiveLayerId(layerId);
    // Origin override (release / right-click location) stays set for the next Run.
    // For variations, the current node selection is what gets used.
  }, []);

  const selectionCount = selectedNodes.length;
  // One Lock TOGGLE for the whole selection: if everything selected is already locked the
  // button unlocks, otherwise it locks (icon/label reflect the action it will take).
  const allLocked = selectionCount > 0 && selectedNodes.every((n) => n.data?.locked);
  const canAddSelected = useMemo(() => selectedNodes.some((n) => n.data?.kind === 'image' && n.data?.url), [selectedNodes]);
  // When a timeline clip is selected and the active agent can fill it, the panel
  // switches to "fill this clip" mode (Run targets the clip, not the board).
  const focusedClip = useMemo(() => timelineEvents.find((e) => e.id === selectedEventId) || null, [timelineEvents, selectedEventId]);
  const clipMode = !!focusedClip && CLIP_FILLABLE.has(activeLayerId);
  const clipLabel = focusedClip ? `clip ${timelineEvents.indexOf(focusedClip) + 1}${focusedClip.beat ? ` · ${focusedClip.beat}` : ''}` : '';

  // Board images not yet tagged into the bible — what "Build brand kit" classifies.
  const untaggedImageCount = useMemo(() => nodes.filter((n) => n.data?.kind === 'image' && (n.data?.localUrl || n.data?.url)
    && !n.data?.bibleRole && !n.id.startsWith('shot-') && !n.id.startsWith('film-')).length, [nodes]);
  // Where the project stands in the explicit Film pipeline — derived from the
  // actual artifacts (never a stored checklist). The director chat reads this so
  // the user always knows the stage and the next step (TRANSPARENCY).
  const filmPipeline = useMemo(() => pipelineStatus({
    idea: nodes.find((n) => n.type === 'story' && n.data?.idea)?.data?.idea || '',
    storyPrompt: nodes.find((n) => n.type === 'story' && n.data?.prompt)?.data?.prompt || '',
    bibleEntries,
    cutCards: nodes.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
    filmUrl: timeline.film?.url || '',
    candidates: untaggedImageCount,
  }), [bibleEntries, nodes, timeline.film, untaggedImageCount]);
  // Narrate pipeline-stage completions in the director chat (e.g. the tag that
  // completes casting): the user's off-chat actions advance the conversation too.
  const stagePrevRef = useRef(null);
  useEffect(() => {
    if (!filmMode) { stagePrevRef.current = null; return; }
    const prev = stagePrevRef.current;
    stagePrevRef.current = Object.fromEntries(filmPipeline.map((s) => [s.id, s.status]));
    if (!prev) return;
    filmPipeline.forEach((s) => {
      if (prev[s.id] && prev[s.id] !== 'done' && s.status === 'done') {
        const next = filmPipeline.find((x) => x.status !== 'done');
        pushFilmNote(next
          ? `${s.label} ✓ — next: ${next.label.toLowerCase()}. Say “continue” and I'll line it up, or pick it from the left rail.`
          : `${s.label} ✓ — the film is complete. Press ▶ on the timeline.`);
      }
    });
  }, [filmPipeline, filmMode, pushFilmNote]);

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

  // The director's ✕ = RESET all the way back to the "What are we making?" launcher
  // (user's explicit instruction — that IS the initial board state). So besides
  // wiping the board/takes/idea, it CLEARS THE RECIPE (recipe:null → filmMode off →
  // launcher shows) and closes the dock. The decision History (audit log) is kept.
  const resetFilm = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setFilmProgress(null);
    setSelectedEventId(null);
    setActiveLayerId(null);
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
  const tagCtx = useMemo(() => ({ onTagRole: tagNode, onImgError: healNodeUrl, onDeconstruct: handleBreakdownTake, deconstructingId: deconstructing, onAddToTimeline: addTakeToTimeline, onRemoveFromTimeline: removeTakeFromTimeline, onTimelineIds: onTimelineNodeIds }), [tagNode, healNodeUrl, handleBreakdownTake, deconstructing, addTakeToTimeline, removeTakeFromTimeline, onTimelineNodeIds]);

  // Handlers only — each Story node reads its OWN state from node.data and calls these
  // with its id, so one stable context drives every Story element on the board.
  const storyCtx = useMemo(() => ({
    onEditPrompt: editStoryPrompt,
    onSetComplexity: setStoryComplexity,
    onRegenerate: regenerateStory,
    onShapeSource: shapeStorySource,
    onCast: draftCastFromStory,
    onShoot: shootFilm,
    onClose: removeStoryNode,
  }), [editStoryPrompt, setStoryComplexity, regenerateStory, shapeStorySource, draftCastFromStory, shootFilm, removeStoryNode]);

  return (
    <AssetNodeContext.Provider value={tagCtx}>
    <CutContext.Provider value={cutCtx}>
    <StoryScriptContext.Provider value={storyCtx}>
    <div style={{ display: 'flex', height: '82vh', border: '1px solid #e5e6eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <LayerRail
        activeLayerId={activeLayerId}
        onActivate={setActiveLayerId}
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
        {/* Floating toolbar — just the seed + the contextual selection action. Add /
            Library / History moved onto the zoom Controls (icon-only); Fit was redundant
            with the Controls' own fit button, so it's gone. Narrow → never crowds the
            centered status pill below. */}
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
          <Space>
            {/* Sequence seed — one seed for every shot. Lock it to hold every variable
                but your prompt edits constant across re-shoots (the iteration lever). */}
            {filmMode && (
              <Tooltip content="Sequence seed — one seed for every shot. 🔒 Lock it and a prompt edit becomes the ONLY changed variable across re-shoots; 🎲 rerolls; unlocked re-rolls each shoot. (Whether Seedance honors it is being verified.)">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 28, padding: '0 4px', background: '#fff', border: '1px solid #e5e6eb', borderRadius: 4 }}>
                  <Text style={{ fontSize: 11, color: '#86909c', fontWeight: 600 }}>Seed</Text>
                  <InputNumber
                    size="mini"
                    hideControl
                    min={0}
                    placeholder="random"
                    value={seed.value ?? undefined}
                    onChange={(v) => setSeed((s) => ({ ...s, value: (v == null || v === '') ? null : Math.max(0, Math.round(Number(v))) }))}
                    style={{ width: 86 }}
                  />
                  <Button size="mini" type="text" icon={<IconRefresh />} onClick={() => setSeed((s) => ({ ...s, value: rollSeed() }))} style={{ color: '#86909c', padding: '0 3px' }} />
                  <Button
                    size="mini"
                    type="text"
                    icon={seed.locked ? <IconLock /> : <IconUnlock />}
                    onClick={() => setSeed((s) => ({ ...s, locked: !s.locked, value: (!s.locked && s.value == null) ? rollSeed() : s.value }))}
                    style={{ color: seed.locked ? '#b06f10' : '#86909c', padding: '0 3px' }}
                  />
                </span>
              </Tooltip>
            )}
            {/* The one CONTEXTUAL selection action — appears only with a selection (no
                greyed-out dead weight). Lock + Unlock collapse into one state-reflecting
                toggle; locking also preserves the asset (canonical ref never expires).
                Delete is keyboard-driven (Backspace/Delete); Check in is gone — locking
                already preserves. Pan is gone: Space-hold / middle-mouse / scroll pan,
                and left-drag marquee-selects. */}
            {selectionCount > 0 && (
              <Tooltip content={allLocked ? 'Unlock selected' : 'Lock selected (use as canonical reference)'}>
                <Button size="small" type={allLocked ? 'primary' : 'default'} icon={allLocked ? <IconLock /> : <IconUnlock />} onClick={() => setLockOnSelection(!allLocked)} />
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
            hasIdea={nodes.some((n) => n.type === 'story' && n.data?.idea)}
            hasStory={nodes.some((n) => n.type === 'story' && n.data?.prompt)}
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

        {/* The empty board IS the front door — one card starts the short film (opens
            the director). Hidden once the dock is open or anything is on the board. */}
        {nodes.length === 0 && !filmDockOpen && !project.recipe ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 6 }}>
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 560, padding: '0 16px' }}>
              <Text style={{ fontSize: 17, fontWeight: 700 }}>Make a short film</Text>
              <div
                onClick={startShortFilm}
                style={{ width: 280, background: '#fff', border: '1px solid #e5e6eb', borderRadius: 12, boxShadow: '0 4px 18px rgba(0,0,0,0.08)', padding: 18, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 26, marginBottom: 6 }}>🎬</div>
                <Text style={{ fontSize: 14, fontWeight: 700, display: 'block', marginBottom: 4 }}>Short Film</Text>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>Premise → cast → story → shoot.</Text>
                <Button type="primary" size="small" style={{ background: '#b06f10', borderColor: '#b06f10' }}>Start →</Button>
              </div>
              <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                Or work freeform: <b style={{ color: '#165dff' }}>Add</b> / drag files onto the board and run Agents!
              </Text>
            </div>
          </div>
        ) : null}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodesDelete={onNodesDeleted}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          // Only mount nodes inside the viewport — a SHOT card is a heavy subtree (controls,
          // bible chips, media), so rendering off-screen ones makes cost scale with TOTAL
          // cards instead of VISIBLE cards. The single biggest win with a busy board.
          onlyRenderVisibleElements
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
          </Controls>
          <MiniMap position="top-right" pannable zoomable nodeColor={(n) => (n.data?.layerId ? (AGENT_MAP[n.data.layerId]?.color || '#c9cdd4') : '#c9cdd4')} />
        </ReactFlow>

        {ctxMenu && (
          <CanvasContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            maxHeight={ctxMenu.maxHeight}
            selection={selectedNodes}
            onPick={handleContextPick}
            onClose={() => setCtxMenu(null)}
          />
        )}

        {/* The Timeline is the fundamental layer — always on, whatever agent (if
            any) is selected. It's the spine the whole UX hangs on. */}
        <StoryTimeline
          events={timelineEvents}
          targetSeconds={timeline.targetSeconds}
          film={timeline.film}
          collapsed={timelineCollapsed}
          onToggle={() => setTimelineCollapsed((v) => !v)}
          selectedEventId={selectedEventId || selectedNodes[0]?.id}
          apiKeyPresent={!!apiKey?.trim()}
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
      </div>

      {activeLayerId ? (
        <LayerPanel
          layerId={activeLayerId}
          settings={activeSettings}
          setSettings={setActiveSettings}
          selection={selectedNodes}
          running={runningAgents.includes(activeLayerId)}
          onRun={handleRun}
          onClose={() => setActiveLayerId(null)}
          apiKeyPresent={!!apiKey?.trim()}
          apiKey={apiKey}
          clipMode={clipMode}
          clipLabel={clipLabel}
          onClearClip={() => setSelectedEventId(null)}
        />
      ) : null}
    </div>
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
