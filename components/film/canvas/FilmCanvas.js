import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Message, Space, Typography, Tooltip, Modal, Dropdown, Menu } from '@arco-design/web-react';
import {
  IconPlus,
  IconLock,
  IconUnlock,
  IconDelete,
  IconFullscreen,
  IconCloudDownload,
  IconStorage,
  IconUpload,
  IconHistory,
} from '@arco-design/web-react/icon';
import AssetNode, { AssetNodeContext } from './AssetNode';
import CutNode, { CutContext } from './CutNode';
import GroupNode from './GroupNode';
import LayerRail from './LayerRail';
import LayerPanel from './LayerPanel';
import CanvasContextMenu from './CanvasContextMenu';
import LibraryPanel from './LibraryPanel';
import StoryTimeline from './StoryTimeline';
import ConciergeDock from './ConciergeDock';
import FilmDock from './FilmDock';
import PipelineStrip from './PipelineStrip';
import HistoryPanel from './HistoryPanel';
import { AGENT_MAP, AGENTS, createBrowserTransport, classifyAssets } from '../../../utils/film/agents';
import { createProduction, runStep as runAgentOp } from '../../../utils/film/core/production';
import { createFilmingSession } from '../../../utils/film/core/filming';
import { castFromIdea, detectGenre } from '../../../utils/film/core/storyboard';
import { pipelineStatus } from '../../../utils/film/pipeline';
import { readAdIntent, routeStudioAction, AD_ACTIONS } from '../../../utils/film/core/director';
import { createBrowserClient } from '../../../utils/film/core/client';
import { createTrace } from '../../../utils/film/core/trace';
import { emptyTimeline, emptyBible, eventsFromStoryNodes } from '../../../utils/film/projectShape';
import { bibleEntry, timelineEvent, orderedEvents, renumber, mirrorSessionEvents, resolveBibleUrls } from '../../../utils/film/timelineModel';
import { AD_ROLES, AD_ROLE_META, ADVERTISEMENT_RECIPE, SHORT_FILM_RECIPE, RECIPES, LOOK_PACKAGES, adShotPlan, lookDirection, gapPrompt, cutPromptSeed, composeSeedancePrompt, shotReferences, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
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
import { listLibrary, addToLibrary, deleteFromLibrary, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

const nodeTypes = { asset: AssetNode, group: GroupNode, cut: CutNode };

// Agents that can fill a selected timeline clip directly (image agents → the clip's
// keyframe; animate → its rendered shot). Prompt Muse stays board-only (it reads).
const CLIP_FILLABLE = new Set(['inspiration', 'mixMatch', 'characterVariations', 'locationVariations', 'animate']);

const CELL_W = 240;
const CELL_H = 290;
const GROUP_PAD = 12;
const GROUP_HEADER = 34;

// SHOT cards are 300px wide and TALL — the sketch + the pins (cut list, cinematography,
// audio, composed preview, references) run ~640–740px depending on cut count. Tile on a
// generous pitch so rows never collide (gaps for short cards beat overlaps for tall ones).
const CUT_COL_W = 340;
const CUT_ROW_H = 760;
// Asset-plate tiling pitch (image node ≈ 220×280).
const PLATE_COL_W = 260;
const PLATE_ROW_H = 320;

// A top-level node's bounding box for collision-aware placement. React Flow's
// measured dims when it has them; type-based fallbacks for nodes added this tick
// (not yet measured). Children (parentId) live inside groups — callers exclude them.
const NODE_FALLBACK = {
  cut: { w: 300, h: CUT_ROW_H },
  group: { w: 280, h: 220 },
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

// The context every CUT card carries into its keyframe prompt (hero + the user's
// idea verbatim + the look package) — previewed in full on the card, assembled by
// cutPromptSeed at shoot time. ONE derivation for preview and blueprint alike.
const sharedFromProject = (p) => ({
  heroLine: p?.recipe?.subjects?.product ? `The hero of this ad: ${p.recipe.subjects.product}` : '',
  idea: (p?.idea || '').trim(),
  lookLine: p?.recipe?.look ? lookDirection(p.recipe.look) : '',
});

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
  // Seed the Inspiration Board prompt from the project idea so the first Run is
  // one click away and produces something relevant.
  if (settings.inspiration && !settings.inspiration.prompt && project.idea) {
    settings.inspiration.prompt = project.idea;
  }
  // Same for the Topic Explorer — the idea IS a topic to research.
  if (settings.topicExplorer && !settings.topicExplorer.topic && project.idea) {
    settings.topicExplorer.topic = project.idea;
  }
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

const FilmCanvasInner = ({ project, apiKey, onUpdateProject, conciergeOpen, onOpenConcierge, onCloseConcierge }) => {
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
  const [running, setRunning] = useState(false);
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

  // ---- the spine: timeline + bible (single source of truth = the project) ----
  const timeline = useMemo(() => project.timeline || emptyTimeline(), [project.timeline]);
  const bible = useMemo(() => project.bible || emptyBible(), [project.bible]);
  const timelineEvents = useMemo(() => orderedEvents(timeline.events || []), [timeline.events]);
  const bibleEntries = useMemo(() => bible.entries || [], [bible.entries]);
  const bibleRef = useRef(bibleEntries);  // latest bible for the async session/transport
  useEffect(() => { bibleRef.current = bibleEntries; }, [bibleEntries]);

  // Run trace — agent introspection. Every prompt + action in an Ad run is recorded
  // here (the transport is wrapped below) so the whole pipeline can be dumped to .txt
  // and re-assessed. The role resolver tags each reference url with its bible role, so
  // cross-role leakage (e.g. Talent fed into a Location shot) is obvious in the dump.
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
        nodeId: n.id,
        locked: true,
      }));
    const sig = (es) => es.map((e) => `${e.nodeId}:${e.role}:${e.url}`).join('|');
    updateBible((cur) => (sig(cur.entries || []) === sig(derived) ? cur : { ...cur, entries: derived }));
  }, [nodes, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    filmingRef.current = null;
    setFilmChunks(project.filming?.chunks || []);
    chunkStageRef.current = new Map();
    setFilmStage('');
    setFilmProgress(null);
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

  const addNote = useCallback(() => {
    const center = rfInstance
      ? rfInstance.screenToFlowPosition({
          x: (wrapperRef.current?.clientWidth || 800) / 2,
          y: (wrapperRef.current?.clientHeight || 600) / 2,
        })
      : { x: 200, y: 200 };
    const node = createAssetNode({ kind: 'text', label: 'Note', text: 'Double-click to edit…', position: center });
    setNodes((ns) => ns.concat(node));
  }, [rfInstance, setNodes]);

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

  const preserveSelection = useCallback(async () => {
    const targets = nodes.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url && !n.data?.preserved);
    if (targets.length === 0) {
      Message.info('Nothing to check in (only un-preserved images can be saved)');
      return;
    }
    Message.info(`Checking in ${targets.length} asset${targets.length > 1 ? 's' : ''}…`);
    const results = await Promise.allSettled(targets.map((n) => preserveNode(n)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) Message.warning(`${failed.length} could not be preserved: ${failed[0].reason?.message || ''}`);
    else Message.success('Checked in — these assets are now permanent');
  }, [nodes, preserveNode]);

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
      const { assets } = await classifyAssets({ apiKey: apiKey.trim(), client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())), images, idea: project.idea, roles: AD_ROLES, requiredRoles: ADVERTISEMENT_RECIPE.requiredRoles });
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
  }, [apiKey, project.idea, tagNode, setNodes]);

  // Generate a missing bible role RIGHT on the board: an on-brand, role-correct image
  // (gapPrompt: role + idea + look) using the existing bible as downscaled style refs
  // → drops a PRE-TAGGED node, which flows into the bible via the reconciler.
  // Parallel-safe (functional setNodes); messages on its own, never throws.
  const generateGapNode = useCallback(async (role, detail = '') => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return null; }
    const prompt = gapPrompt(role, project.idea, project.recipe?.look, detail);
    // ONLY same-role references — never cross-inject other anchors. Feeding the whole
    // bible (e.g. the Talent face) into every gap is what produced "the same girl
    // everywhere": Seedream treats refs as visual identity. A true gap (missing role)
    // has no same-role refs → it's generated purely from the idea + look package, which
    // is what carries on-brand coherence here (not an unrelated anchor's pixels).
    const refs = bibleRef.current.filter((b) => b.role === role).map((b) => b.url).filter(Boolean).slice(0, 4);
    const smallRefs = (await Promise.all(refs.map(downscaleRef))).filter(Boolean);
    // Parallel "Generate all" fires several of these at once — capture this run's id and
    // stamp the log with it explicitly, so the workflows don't interleave in the trace.
    const runId = traceRef.current.startRun({ note: `Generate gap · ${AD_ROLE_META[role]?.label || role}` });
    const rec = traceRef.current.log({ runId, kind: 'bible.generate', role, prompt, refs: refs.length ? [`${role}×${refs.length}`] : [], model: 'seedream', status: 'running' });
    try {
      const res = await fetch('/api/film/imagine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), prompt, referenceImages: smallRefs, size: '2K' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || 'Generation failed');
      rec.status = 'ok'; rec.result = data.url;
      const o = rfInstance ? rfInstance.screenToFlowPosition({ x: 90, y: 130 }) : { x: 90, y: 130 };
      const node = createAssetNode({ kind: 'image', url: data.url, label: AD_ROLE_META[role]?.label || role, position: { x: o.x + Math.round(Math.random() * 40), y: o.y + Math.round(Math.random() * 40) }, preserved: true });
      node.data.bibleRole = role;
      node.data.locked = true;
      setNodes((ns) => ns.concat(node));
      Message.success(`Generated a ${(AD_ROLE_META[role]?.label || role).toLowerCase()} → added to your bible`);
      return role;
    } catch (err) {
      rec.status = 'error'; rec.error = err.message;
      Message.error(`Couldn't generate ${AD_ROLE_META[role]?.label || role}: ${err.message}`);
      return null;
    }
  }, [apiKey, project.idea, project.recipe, rfInstance, setNodes]);

  // A user-supplied file for a specific gap role → a PRE-TAGGED board node, staged to
  // TOS in the background (so it's usable downstream) with a downscaled bible ref.
  const addTaggedAsset = useCallback(({ role, dataUrl, name }) => {
    if (!dataUrl) return;
    const o = rfInstance ? rfInstance.screenToFlowPosition({ x: 90, y: 130 }) : { x: 90, y: 130 };
    const node = createAssetNode({ kind: 'image', url: dataUrl, label: name || AD_ROLE_META[role]?.label || role, position: { x: o.x + Math.round(Math.random() * 40), y: o.y + Math.round(Math.random() * 40) } });
    node.data.bibleRole = role;
    node.data.locked = true;
    setNodes((ns) => ns.concat(node));
    stageNode(node.id, dataUrl, name, 'image');
    scheduleRefDownscale(node.id, dataUrl);
  }, [rfInstance, setNodes, stageNode, scheduleRefDownscale]);

  // ---- selection actions ----
  const setLockOnSelection = useCallback((locked) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, locked } } : n)));
    if (locked) {
      // Locking marks an asset canonical → preserve it so references never expire.
      const toPreserve = nodes.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url && !n.data?.preserved);
      toPreserve.forEach((n) => { preserveNode(n).catch((e) => Message.warning(`Preserve failed: ${e.message}`)); });
    }
  }, [setNodes, nodes, preserveNode]);

  const deleteSelection = useCallback(() => {
    setNodes((ns) => {
      const deletedIds = new Set(ns.filter((n) => n.selected).map((n) => n.id));
      // Deleting a group frame also removes its children (no orphans).
      return ns.filter((n) => !n.selected && !deletedIds.has(n.parentId));
    });
  }, [setNodes]);

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

    // A new storyboard replaces the old one: clear cut cards and anchor the new
    // grid below everything else on the board.
    let sbBase = null;
    if (layer.id === 'storyboard') {
      const others = nodesRef.current.filter((n) => n.type !== 'cut');
      // Anchor the new card grid below everything else — using each node's ACTUAL
      // bottom edge (not a flat +360 guess that overlapped tall nodes).
      const bottom = others.length ? Math.max(...others.map((n) => { const r = nodeRect(n); return r.y + r.h; })) : 40;
      const left = others.length ? Math.min(...others.map((n) => n.position.x)) : 80;
      sbBase = { x: left, y: bottom + 80 };
      setNodes((ns) => ns.filter((n) => n.type !== 'cut'));
      setEdges((es) => es.filter((e) => !String(e.id).startsWith('cutedge-')));
    }
    const fallback = rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 160 }) : { x: 160, y: 160 };
    const cellH = cellHeightForRatio(settings.ratio);
    let baseOrigin = origin || originFromSelection(selectionNodes, fallback);
    // Snap to open space (unless the caller pinned an explicit origin, or this is
    // a storyboard run which anchors its own base below everything). Estimate the
    // block: a grouped run is one frame; an ungrouped run lays a ~4-wide grid.
    if (!origin && layer.id !== 'storyboard') {
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

    // MULTI-group support (Topic Explorer: one titled frame per discovered concept).
    // An agent calls onGroup({ label }) per concept and stamps its assets with the
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
      // The shot list is read first → onPlan lays every card immediately (prompts
      // visible, a "sketching…" placeholder where the drawing will go). Then each
      // sketch fills its card via onPanel — so the board is never silently empty.
      onPlan: (panels) => { if (storyboardPanelRef.current) panels.forEach((p) => storyboardPanelRef.current({ ...p, sketching: true }, sbBase)); },
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
      if (!event.keyframeUrl) { Message.warning('This clip has no keyframe yet — fill it with Inspiration or Mix & Match first.'); return; }
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

    if (agentId === 'mixMatch' && refs.length < 2) { Message.warning('Mix & Match needs ≥2 references — select 2+ board images or add bible anchors.'); return; }
    if ((agentId === 'characterVariations' || agentId === 'locationVariations') && !refs.length) { Message.warning('Select a reference image on the board (or add a bible anchor) for variations.'); return; }
    setClipFields(event.id, { status: 'rendering' });
    try {
      // The clip's BEAT is the prompt (that's the shot description) — it wins over the
      // panel's idea-seeded prompt. prompt feeds inspiration; direction feeds
      // mixMatch/variations (Mix & Match's panel field is `prompt`). Bible = the look.
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
    const layer = AGENT_MAP[activeLayerId];
    if (!layer) return;
    const clip = timelineEvents.find((e) => e.id === selectedEventId);
    setRunning(true);
    try {
      // A timeline clip is selected → the agent fills THAT clip. Otherwise the
      // classic board run (generate cards from the board selection).
      if (clip && CLIP_FILLABLE.has(activeLayerId)) {
        await fillClipWithAgent(clip, activeLayerId, activeSettings);
      } else {
        const selNodes = nodes.filter((n) => n.selected);
        const origin = originOverride.current || undefined;
        originOverride.current = null;
        // Mix & Match's story-moments need locations: when only the character is
        // selected, the bible's location anchors become the stage set. The
        // Storyboard reads the idea + the REAL tagged anchors — inject both.
        const settings = activeLayerId === 'mixMatch'
          ? { ...activeSettings, locationUrls: bibleRef.current.filter((b) => b.role === 'location' && b.url).map((b) => b.url) }
          : activeLayerId === 'storyboard'
            ? { ...activeSettings, idea: (activeSettings.idea || '').trim() || projectRef.current?.idea || '', bibleEntries: bibleRef.current }
            : activeSettings;
        const { result } = await runAgent({ agentId: activeLayerId, settings, selectionNodes: selNodes, origin });
        Message.success(result?.async
          ? `${layer.label} started — the shot is cooking on the board`
          : `${layer.label} finished`);
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setRunning(false);
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
    // AD recipe → drive the producer from the blueprint's shot grammar. Each shot
    // pulls only its beat's bible roles, so the bible (not raw board sources) is
    // the input — no cross-role identity leak. (The Short Film recipe NEVER comes
    // through here — the Filming Loop / Storyboard cards drive it.)
    const useBlueprint = project.recipe?.id === ADVERTISEMENT_RECIPE.id;
    const look = project.recipe?.look;
    // The confirmed intent's hero rides along in every shot prompt — "Hero reveal"
    // means nothing to the image model unless it knows the hero IS desert wildlife.
    const heroLine = project.recipe?.subjects?.product ? `The hero of this ad: ${project.recipe.subjects.product}` : '';
    // An explicit blueprint (the user-reviewed CUT cards) wins verbatim.
    const blueprint = blueprintOverride || (useBlueprint ? {
      // Hero refs anchor EVERY shot (consistency of the user's own product/subject
      // is the #1 requirement) — production.js appends them to each beat's roles.
      heroRole: 'product',
      shots: adShotPlan(timeline.targetSeconds).map((b) => ({
        beat: b.beat,
        roles: b.roles,
        camera: b.camera,
        motion: b.motion,
        // The per-shot prompt seed the writer expands: beat + hero + the user's idea +
        // the look package's cinematography. Bible roles condition the image pixels;
        // this sets the shot's content.
        promptSeed: [b.beat, heroLine, project.idea, look ? lookDirection(look) : ''].map((s) => (s || '').trim()).filter(Boolean).join('. '),
      })),
    } : undefined);
    const session = createProduction(
      // targetSeconds sizes per-shot durations; the blueprint carries the count.
      {
        idea: project.idea,
        sources: useBlueprint ? [] : sources, // blueprint shots reference the bible only
        targetSeconds: timeline.targetSeconds,
        bible: [...bibleRef.current, ...cutAssetEntries()],
        blueprint,
      },
      traced,
      { mode: initialState?.mode || 'auto', onEvent: handleSessionEvent, ...(initialState ? { initialState } : {}), ...sessionOpts },
    );
    sessionRef.current = session;
    return session;
  }, [apiKey, project.idea, project.recipe, timeline.targetSeconds, handleSessionEvent, cutAssetEntries]);

  // ---- Timeline + Bible actions (the spine the whole UX hangs on) -------------

  // Auto-fill ("do it"): shoot the AD's explicit blueprint end to end. Plans come
  // from the Storyboard or the ad grammar only — never invented here.
  const handleAutoFill = useCallback(async (opts) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    if (project.recipe?.id !== ADVERTISEMENT_RECIPE.id) {
      Message.info('Plan the shots first — 🎬 Storyboard for a film, or the ad concierge (“Make the ad”) for a spot.');
      return;
    }
    if (opts && opts.end > opts.start) {
      Message.info('To redo part of the cut, re-shoot a specific shot from its card (🎬).');
      return;
    }
    // Open a workflow in the trace and record the inputs it started from (idea + bible
    // composition), so the History panel reads "here's what I had → here's what I did".
    const bibleSummary = AD_ROLES.map((r) => { const n = bibleRef.current.filter((b) => b.role === r).length; return n ? `${r}×${n}` : null; }).filter(Boolean).join(' ');
    traceRef.current.startRun({ note: `Generate the ad · ${timeline.targetSeconds}s` });
    traceRef.current.log({ level: 'run', kind: 'inputs', note: `idea="${(project.idea || '').replace(/\s+/g, ' ').trim().slice(0, 160)}" · bible: ${bibleSummary || '(none)'}` });
    setTimelineCollapsed(false); // expand to show the cut being built
    const session = buildSession([], null);
    session.setMode('auto');
    setAutoFillBusy(true);
    try {
      await session.runAll(); // blueprint plan, every shot, stitch
    } catch (err) {
      Message.error(err.message);
    } finally {
      setAutoFillBusy(false);
    }
  }, [apiKey, project.idea, project.recipe, buildSession, timeline.targetSeconds]);

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
  // Write the brief through to the project AS each interview answer lands — not at
  // the end. Gap generation (and everything else) reads project.idea/recipe, so
  // deferring the write until "Make the ad" meant every in-interview Generate ran
  // with an EMPTY idea → Seedream free-associated generic ad clichés (the
  // craft-beer-logo bug). The project is the single source of truth; keep it current.
  const handleBriefUpdate = useCallback(({ idea, durationSec, aspect, look, intent } = {}) => {
    onUpdateProject((prev) => {
      if (!prev || prev.id !== loadedIdRef.current) return prev;
      const next = { ...prev };
      if (idea != null && idea.trim()) next.idea = idea.trim();
      if (durationSec != null || aspect != null || look != null || intent != null) {
        next.recipe = {
          ...(prev.recipe || {}),
          id: ADVERTISEMENT_RECIPE.id,
          durationSec: durationSec != null ? durationSec : (prev.recipe?.durationSec ?? ADVERTISEMENT_RECIPE.defaultDuration),
          aspect: aspect != null ? aspect : (prev.recipe?.aspect ?? ADVERTISEMENT_RECIPE.defaultAspect),
          look: look != null ? look : (prev.recipe?.look ?? 'warmLifestyle'),
          // The confirmed intent: what kind of ad, who the hero is, whether brand
          // belongs. Gap prompts + the producer's shot prompts read these.
          ...(intent ? { kind: intent.kind, subjects: intent.subjects, brandRelevant: intent.brandRelevant } : {}),
        };
      }
      if (durationSec != null) next.timeline = { ...(prev.timeline || emptyTimeline()), targetSeconds: durationSec };
      return next;
    });
  }, [onUpdateProject]);

  // Read the ad intent from the idea (one cheap classification call), traced so the
  // decision shows in History. Null on any failure → the interview proceeds plain.
  const readIntentForIdea = useCallback(async (ideaText) => {
    if (!apiKey?.trim() || !ideaText?.trim()) return null;
    const rec = traceRef.current.log({ kind: 'intent.read', prompt: ideaText.replace(/\s+/g, ' ').slice(0, 160), status: 'running' });
    try {
      const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
      const intent = await readAdIntent({ idea: ideaText }, ctx);
      rec.status = 'ok';
      rec.result = !intent ? 'no read (fallback to plain interview)'
        : intent.valid === false ? 'INVALID brief — asked to clarify'
          : `${intent.kind} · hero: ${intent.subjects?.product || '?'}${intent.brandRelevant === false ? ' · no brand' : ''}`;
      return intent;
    } catch (err) {
      rec.status = 'error'; rec.error = err.message;
      return null;
    }
  }, [apiKey]);

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

  // Lay ONE storyboard panel as a CUT card (direct-to-video: the card's real refs +
  // the photoreal frame feed Seedance). Wired into runAgent via the ref above.
  // Two-phase: onPlan lays the card with sketching:true (placeholder where the
  // frame will go); onPanel later fills sketchUrl. When the card already exists
  // we MERGE — so a frame landing never clobbers an edit the user made meanwhile.
  storyboardPanelRef.current = (panel, base) => {
    if (!panel || !base) return;
    const id = `cut-${panel.index}`;
    const sketching = !!panel.sketching && !panel.sketchUrl;
    setNodes((ns) => {
      const existing = ns.find((n) => n.id === id);
      if (existing) {
        return ns.map((n) => (n.id === id
          ? { ...n, data: { ...n.data, sketchUrl: panel.sketchUrl || n.data.sketchUrl, sketching } }
          : n));
      }
      // Seed the SHOT card's pins from the panel: ONE cut (the action) the user can
      // split (≤6s each); cinematography from the chosen shot template (its move is
      // already in the line — no camera append); audio empty (optional). References =
      // the panel's real refs (+ the photoreal frame at shoot time). composeSeedance-
      // Prompt assembles the final Seedance 2.0 prompt.
      const sec = Math.min(15, Math.max(5, panel.durationSec || 10));
      const cine = shotTemplateCinematography(panel.shotTemplate, projectRef.current?.genre?.line || '');
      const card = {
        id,
        type: 'cut',
        position: { x: base.x + (panel.index % 3) * CUT_COL_W, y: base.y + Math.floor(panel.index / 3) * CUT_ROW_H },
        data: {
          cut: panel.index,
          beat: panel.title,
          cuts: [{ action: panel.framing ? `${panel.framing}. ${panel.action}` : panel.action, seconds: Math.min(6, sec) }],
          cinematography: cine,
          shotTemplate: panel.shotTemplate || '',
          cinePreset: (SHOT_TEMPLATE_BY_ID[panel.shotTemplate] && SHOT_TEMPLATE_BY_ID[panel.shotTemplate].name) || '',
          audio: '',
          durationSec: sec,
          refIds: panel.refEntryIds || [],
          assetRefs: [],
          sketchUrl: panel.sketchUrl || '',
          sketching,
          direct: true,
        },
      };
      return [...ns, card];
    });
    syncCutEdges(id, panel.refEntryIds || [], []);
  };

  const layoutCutCards = useCallback(({ targetSeconds }) => {
    const plan = adShotPlan(targetSeconds);
    const perShot = Math.min(15, Math.max(5, Math.round(targetSeconds / Math.max(1, plan.length))));
    const heroIds = bibleRef.current.filter((e) => e.role === 'product').map((e) => e.id);
    const others = nodesRef.current.filter((n) => n.type !== 'cut');
    const bottom = others.length ? Math.max(...others.map((n) => { const r = nodeRect(n); return r.y + r.h; })) : 40;
    const left = others.length ? Math.min(...others.map((n) => n.position.x)) : 80;
    const base = { x: left, y: bottom + 80 };
    const cards = plan.map((b, i) => ({
      id: `cut-${i}`,
      type: 'cut',
      position: { x: base.x + (i % 3) * CUT_COL_W, y: base.y + Math.floor(i / 3) * CUT_ROW_H },
      data: {
        cut: i,
        beat: b.beat,
        camera: b.camera || 'auto',
        motion: b.motion || '',
        durationSec: perShot,
        // CONTENT starts empty — the user writes the shot's specifics; the card's
        // full-prompt preview shows what rides along regardless (beat + hero + idea
        // + look, assembled by cutPromptSeed at shoot time).
        prompt: '',
        refIds: [...new Set([...bibleRef.current.filter((e) => (b.roles || []).includes(e.role)).map((e) => e.id), ...heroIds])],
        assetRefs: [],
      },
    }));
    setNodes((ns) => [...ns.filter((n) => n.type !== 'cut'), ...cards]);
    cards.forEach((c) => syncCutEdges(c.id, c.data.refIds, []));
    traceRef.current.log({ kind: 'plan', note: `${cards.length} CUT cards laid out for review`, plan: cards.map((c, i) => `${i + 1}. ${c.data.beat}`).join('  |  ') });
    return cards.length;
  }, [setNodes, syncCutEdges]);

  // Lock the framing + lay out the cuts; generation waits for Action.
  const handleGenerateAd = useCallback(({ idea, durationSec, aspect, look }) => {
    onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? {
      ...prev,
      idea: (idea && idea.trim()) || prev.idea,
      // Spread the previous recipe FIRST so the confirmed intent (kind/subjects/
      // brandRelevant, written during the interview) survives the final framing.
      recipe: { ...(prev.recipe || {}), id: ADVERTISEMENT_RECIPE.id, durationSec, aspect, look },
      timeline: { ...(prev.timeline || emptyTimeline()), targetSeconds: durationSec },
    } : prev));
    traceRef.current.startRun({ note: `Lay out cuts · ${durationSec}s` });
    const n = layoutCutCards({ idea: (idea || '').trim(), targetSeconds: durationSec, look });
    return n > 0 ? 'review' : 'failed';
  }, [onUpdateProject, layoutCutCards]);

  // A SHOT card → one blueprint shot. Two card kinds:
  //  - direct (storyboard SHOT cards): NO keyframe — the composed Seedance 2.0
  //    prompt (REFERENCES + cuts + cinematography + audio) and the card's REAL
  //    refs + the storyboard frame go straight to Seedance, in [Image1..N] order.
  //  - ad cards: full keyframe seed (content + shared context) + camera/motion.
  // keepTake carries an existing take along so Action doesn't re-shoot it.
  const shotFromCard = useCallback((c, { keepTake = true } = {}) => {
    const refEntryIds = [...(c.data.refIds || []), ...(c.data.assetRefs || []).map(extRefId)];
    // Direct (film) SHOT card: assemble the Seedance 2.0 prompt from the pins, and
    // send the SAME ordered references (cast/location + sketch) as explicit refUrls
    // so the prompt's [ImageN] matches the images sent. camera 'auto' (the move
    // lives in the CINEMATOGRAPHY section). Total duration = sum of the cuts.
    if (c.data.direct) {
      const references = shotReferences(c.data, bibleRef.current);
      // Migrate a pre-pins card (single data.prompt) so it still shoots.
      const cuts = (c.data.cuts && c.data.cuts.length)
        ? c.data.cuts
        : (c.data.prompt ? [{ action: c.data.prompt, seconds: Math.min(6, c.data.durationSec || 5) }] : []);
      const cutsTotal = cuts.reduce((s, k) => s + (Number(k?.seconds) || 0), 0);
      return {
        beat: c.data.beat,
        direct: true,
        motion: composeSeedancePrompt({ references, cuts, cinematography: c.data.cinematography || '', audio: c.data.audio || '' }),
        camera: 'auto',
        durationSec: Math.min(15, Math.max(5, cutsTotal || c.data.durationSec || 10)),
        refEntryIds,
        refUrls: references.map((r) => r.url),
        ...(keepTake && c.data.shotUrl ? { shotUrl: c.data.shotUrl } : {}),
      };
    }
    // Ad card: a two-model pipeline (keyframe writer → Seedance), so it keeps two
    // prompts — the keyframe seed and the Seedance motion line — each editable.
    const ov = typeof c.data.promptOverride === 'string' && c.data.promptOverride.trim() ? c.data.promptOverride.trim() : null;
    const seedOv = typeof c.data.seedOverride === 'string' && c.data.seedOverride.trim() ? c.data.seedOverride.trim() : null;
    return {
      beat: c.data.beat,
      promptSeed: seedOv || cutPromptSeed({ content: c.data.prompt, beat: c.data.beat, ...sharedFromProject(projectRef.current) }),
      camera: ov ? 'auto' : (c.data.camera || 'auto'),
      motion: ov || (c.data.motion || ''),
      durationSec: c.data.durationSec || 10,
      refEntryIds,
      ...(keepTake && c.data.shotUrl ? { shotUrl: c.data.shotUrl, keyframeUrl: c.data.keyframeUrl || '' } : {}),
    };
  }, []);

  // Live session → card feedback: running/failed/keyframe/shot land on the cards
  // (border + status tag) as the mapped steps progress.
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
        if (hit.kind === 'anim' && e.kind === 'video') onPatchCut(hit.cardId, { shotUrl: e.url, status: 'shot' });
      }
    });
  }, [onPatchCut]);

  // 🎬 on a single card: shoot JUST this cut (keyframe + animate, no stitch) — the
  // same engine, so retries and History tracing come along. The take lands on the
  // card, the board and the timeline at the cut's slot; re-clicking re-shoots.
  const handleShootCut = useCallback(async (cutId) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    const card = nodesRef.current.find((n) => n.id === cutId && n.type === 'cut');
    if (!card || card.data.status === 'running') return;
    // A fresh take replaces the old one — drop the previous timeline event.
    const oldStep = card.data.lastAnimStepId;
    if (oldStep) updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => e.stepId !== oldStep) }));
    traceRef.current.startRun({ note: `Shoot CUT ${(card.data.cut ?? 0) + 1} · ${card.data.beat || ''}` });
    setTimelineCollapsed(false);
    const session = buildSession([], null, { shots: [shotFromCard(card, { keepTake: false })] }, { stitch: false });
    onPatchCut(cutId, { status: 'running', shotUrl: '', keyframeUrl: '' });
    try {
      const plan = await session.plan();
      wireCutSession(session, mapCutSteps(plan, [card]));
      const anim = plan.find((s) => s.agent === 'animate');
      if (anim) onPatchCut(cutId, { lastAnimStepId: anim.id });
      await session.runAll();
      // Settle from the final session state (belt and braces over the live events).
      const st = session.state;
      const animStep = (st.plan || []).find((s) => s.agent === 'animate');
      const kfStep = (st.plan || []).find((s) => s.agent === 'inspiration');
      const pick = (s) => s && ((s.outputs || []).find((o) => o.id === s.pickedId) || (s.outputs || [])[0]);
      const shotOut = pick(animStep);
      const kfOut = pick(kfStep);
      onPatchCut(cutId, shotOut?.url
        ? { status: 'shot', shotUrl: shotOut.url, keyframeUrl: kfOut?.url || '' }
        : { status: 'failed' });
      // Slot the take at the cut's position on the spine.
      if (anim) {
        const slot = card.data.cut ?? 0;
        updateTimeline((cur) => ({ ...cur, events: (cur.events || []).map((e) => (e.stepId === anim.id ? { ...e, order: slot } : e)) }));
      }
    } catch (err) {
      onPatchCut(cutId, { status: 'failed' });
      Message.error(err.message);
    }
  }, [apiKey, buildSession, shotFromCard, wireCutSession, onPatchCut, updateTimeline]);

  // 🎬 Action: shoot exactly what the CUT cards say (their content/camera/refs/
  // durations become the blueprint verbatim). Cuts already shot from their card keep
  // their takes — Action shoots the rest, then stitches EVERYTHING in card order.
  const handleAction = useCallback(async () => {
    const cards = nodesRef.current.filter((n) => n.type === 'cut').sort((a, b) => (a.data?.cut ?? 0) - (b.data?.cut ?? 0));
    if (!cards.length) { Message.warning('No CUT cards on the board — say “Make the ad” first.'); return; }
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    // Per-cut takes get re-mirrored under the new session's step ids — drop the old events.
    const oldStepIds = new Set(cards.map((c) => c.data?.lastAnimStepId).filter(Boolean));
    if (oldStepIds.size) updateTimeline((cur) => ({ ...cur, events: (cur.events || []).filter((e) => !oldStepIds.has(e.stepId)) }));
    const kept = cards.filter((c) => c.data?.shotUrl).length;
    const blueprint = { shots: cards.map((c) => shotFromCard(c)) };
    traceRef.current.startRun({ note: `Action · ${cards.length} cuts${kept ? ` (${kept} already shot)` : ''}` });
    setTimelineCollapsed(false);
    const session = buildSession([], null, blueprint);
    session.setMode('auto');
    setAutoFillBusy(true);
    try {
      const plan = await session.plan();
      wireCutSession(session, mapCutSteps(plan, cards));
      const anims = plan.filter((s) => s.agent === 'animate');
      cards.forEach((c, i) => {
        if (anims[i]) onPatchCut(c.id, { lastAnimStepId: anims[i].id, ...(c.data.shotUrl ? {} : { status: 'running' }) });
      });
      await session.runAll();
    } catch (err) {
      Message.error(err.message);
    } finally {
      setAutoFillBusy(false);
    }
  }, [apiKey, buildSession, shotFromCard, wireCutSession, onPatchCut, updateTimeline]);

  // The card context: patching, the shared-context preview, shooting and attaching.
  const cutShared = useMemo(() => sharedFromProject(project), [project]);
  const cutCtx = useMemo(() => ({
    onPatchCut,
    bibleEntries,
    shared: cutShared,
    onShootCut: handleShootCut,
    onAttachSelected: attachSelectedToCut,
    onAttachAsset: attachRefToCut,
  }), [onPatchCut, bibleEntries, cutShared, handleShootCut, attachSelectedToCut, attachRefToCut]);

  // ---- the Filming Loop (Short Film mode) --------------------------------------
  // generate 10–15s → validate (QC advisory + human gate) → correct by aspects →
  // continue. The session is the driver; the timeline below is just the view.
  const filmMode = project.recipe?.id === SHORT_FILM_RECIPE.id;
  const [filmChunks, setFilmChunks] = useState(() => project.filming?.chunks || []);
  const [filmBusy, setFilmBusy] = useState(false);
  const filmingRef = useRef(null);

  // Mirror the chunk chain onto timeline.events (the zoom-out view): chunk ids are
  // event ids, so manual events coexist and clicks select chunks.
  const syncFilmingEvents = useCallback((state) => {
    updateTimeline((cur) => {
      const others = (cur.events || []).filter((e) => !String(e.id).startsWith('ch-'));
      const evs = state.chunks.map((c, i) => timelineEvent({
        id: c.id,
        order: others.length + i,
        beat: c.beat,
        durationSec: c.durationSec,
        keyframeUrl: c.keyframeUrl,
        shotUrl: c.shotUrl,
        status: c.status === 'generating' ? 'rendering'
          : c.status === 'failed' ? 'failed'
            : c.shotUrl ? 'shot'
              : c.keyframeUrl ? 'keyframe' : 'empty',
        locked: c.status === 'validated',
        qc: c.qc || null,
      }));
      return { ...cur, events: [...others, ...evs] };
    });
  }, [updateTimeline]);

  // Live filming narration: diff each state snapshot against the last-known stage
  // per chunk and surface the transitions in the chat + footer — the 4–5 silent
  // minutes of a take get narrated as they actually happen (TRANSPARENCY).
  const chunkStageRef = useRef(new Map()); // chunkId -> { kf, qc, status }
  const filmSeqRef = useRef(0);
  const [filmProgress, setFilmProgress] = useState(null); // { seq, text } → FilmDock prints
  const [filmStage, setFilmStage] = useState('');         // short live label → footers
  const pushFilmNote = useCallback((text) => {
    filmSeqRef.current += 1;
    setFilmProgress({ seq: filmSeqRef.current, text });
  }, []);

  const handleFilmingEvent = useCallback((e) => {
    traceRef.current.ingestSessionEvent(e.type === 'phase' ? { type: 'phase', phase: e.phase } : null);
    if (e.type === 'state') {
      setFilmChunks(e.state.chunks);
      syncFilmingEvents(e.state);
      onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, filming: e.state } : prev));
      const chunks = e.state.chunks || [];
      const seen = chunkStageRef.current;
      chunks.forEach((c) => {
        const prev = seen.get(c.id) || {};
        if (!prev.kf && c.keyframeUrl) pushFilmNote(`Keyframe ready for “${c.beat}” — animating the ${c.durationSec}s take now (usually 4–5 minutes).`);
        if (!prev.qc && c.qc && c.qc.verdict && c.qc.verdict !== 'pass') {
          const issues = (c.qc.issues || []).map((i) => i && i.message).filter(Boolean).join('; ');
          pushFilmNote(`Heads-up — QC says ${c.qc.verdict} on that keyframe${issues ? `: ${issues}` : ''}. Advisory only; you can correct once the take lands.`);
        }
        if (prev.status === 'generating' && c.status === 'failed') pushFilmNote(`The take failed: ${c.error || 'unknown error'}. Tell me what to change, or just try again.`);
        seen.set(c.id, { kf: !!c.keyframeUrl, qc: !!c.qc, status: c.status });
      });
      const working = chunks[chunks.length - 1];
      setFilmStage(working && working.status === 'generating'
        ? (working.keyframeUrl ? `animating ${working.durationSec}s…` : 'making the keyframe…')
        : '');
    } else if (e.type === 'warning') {
      Message.warning(e.message);
    } else if (e.type === 'film') {
      updateTimeline((cur) => ({ ...cur, film: { url: e.url, assetId: e.assetId || null, builtAt: new Date().toISOString() } }));
      Message.success('Film assembled');
    }
  }, [syncFilmingEvents, onUpdateProject, updateTimeline, pushFilmNote]);

  const getFilming = useCallback(() => {
    if (filmingRef.current) return filmingRef.current;
    const transport = createBrowserTransport(apiKey.trim());
    filmingRef.current = createFilmingSession(
      {},
      { client: traceRef.current.wrapClient(transport.client), stitch: traceRef.current.wrapStitch(transport.stitch), lastFrame: transport.lastFrame },
      {
        // Live getters: a chunk generated later sees the CURRENT idea + bible.
        getIdea: () => projectRef.current?.idea || '',
        getBible: () => bibleRef.current,
        initialState: projectRef.current?.filming || null,
        onEvent: handleFilmingEvent,
      },
    );
    return filmingRef.current;
  }, [apiKey, handleFilmingEvent]);

  const filmPropose = useCallback(async () => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return []; }
    traceRef.current.startRun({ note: 'Filming · propose next beats' });
    try {
      return await getFilming().proposeBeats(3);
    } catch (err) {
      Message.error(err.message);
      return [];
    }
  }, [apiKey, getFilming]);

  const filmGenerate = useCallback(async ({ beat, durationSec, aspects }) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    traceRef.current.startRun({ note: `Filming · ${filmChunks.length ? 'continue' : 'first chunk'} · ${durationSec}s` });
    setTimelineCollapsed(false);
    setFilmBusy(true);
    try {
      const chunk = await getFilming().generateNext({ beat, durationSec, aspects });
      if (chunk?.status === 'failed') Message.error(`Chunk failed: ${chunk.error}`);
      else Message.success('Chunk ready — review it below, then approve or correct.');
      return chunk;
    } catch (err) {
      Message.error(err.message);
      return null;
    } finally {
      setFilmBusy(false);
    }
  }, [apiKey, getFilming, filmChunks.length]);

  const filmCorrect = useCallback(async (chunkIdToFix, { aspects, note }) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    traceRef.current.startRun({ note: 'Filming · correct (re-animate)' });
    setFilmBusy(true);
    try {
      const chunk = await getFilming().correct(chunkIdToFix, { aspects, note });
      if (chunk?.status === 'failed') Message.error(`Re-animate failed: ${chunk.error}`);
      else Message.success('New take ready.');
      return chunk;
    } catch (err) {
      Message.error(err.message);
      return null;
    } finally {
      setFilmBusy(false);
    }
  }, [apiKey, getFilming]);

  const filmValidate = useCallback((chunkIdToApprove) => {
    try {
      getFilming().validate(chunkIdToApprove);
      Message.success('Chunk approved — the story continues from here.');
    } catch (err) {
      Message.error(err.message);
    }
  }, [getFilming]);

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
    idea: projectRef.current?.idea || '',
    bibleEntries: bibleRef.current,
    cutCards: nodesRef.current.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
    filmUrl: projectRef.current?.timeline?.film?.url || '',
    candidates: nodesRef.current.filter((n) => n.data?.kind === 'image' && !n.data?.bibleRole).length,
  }), []);

  // Route one chat message → ONE studio action (LLM interprets, traced; the user
  // confirms in the dock; dispatch below is deterministic).
  const routeFilmMessage = useCallback(async (message) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return null; }
    const roles = AD_ROLES.map((r) => { const n = bibleRef.current.filter((b) => b.role === r).length; return n ? `${r}×${n}` : null; }).filter(Boolean).join(' ');
    const lastChunk = filmChunks[filmChunks.length - 1];
    // The pipeline state rides in the routing context, so even free-form answers
    // are grounded in where the project ACTUALLY stands.
    const pipe = livePipeline().map((s) => `${s.label}: ${s.status === 'done' ? 'done' : s.note}`).join(' · ');
    const context = `pipeline — ${pipe} · idea: ${projectRef.current?.idea ? 'set' : 'NOT set'} · genre: ${projectRef.current?.genre?.line ? `locked (${projectRef.current.genre.line})` : 'NOT set'} · bible: ${roles || '(empty)'} · chunks filmed: ${filmChunks.length}${lastChunk ? ` (current: ${lastChunk.status})` : ''} · board selection: ${nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image').length} image(s)`;
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
  }, [apiKey, filmChunks, livePipeline]);

  // The image node behind a bible role (the cast/world anchors as chat targets).
  const nodesForRole = useCallback((role) => bibleRef.current
    .filter((b) => b.role === role && b.nodeId)
    .map((b) => nodesRef.current.find((n) => n.id === b.nodeId && n.data?.kind === 'image'))
    .filter(Boolean), []);

  // Deterministic dispatch of a CONFIRMED chat action to the existing machinery.
  // Returns the chat's reply line (or a beats array for proposeBeats).
  const dispatchFilmAction = useCallback(async (action, params = {}) => {
    const selImages = nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    const lastChunk = filmChunks[filmChunks.length - 1];
    // A premise typed into the chat becomes the project idea when none exists —
    // the pipeline status and every later prompt read it. (Shot-level actions
    // like filmChunk never adopt: a beat is not the film's premise.)
    const adoptIdea = (text) => {
      const t = (text || '').trim();
      if (t && !projectRef.current?.idea?.trim()) {
        onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, idea: t } : prev));
      }
    };
    switch (action) {
      case 'filmChunk': {
        const chunk = await filmGenerate({ beat: params.beat || params.prompt, durationSec: SHORT_FILM_RECIPE.defaultChunkSeconds, aspects: {} });
        return chunk && chunk.status === 'draft'
          ? 'Take landed — review it on the timeline: say “approve” to lock it and continue, or tell me what to fix.'
          : 'That take didn\'t make it — the note above says why. Adjust and try again.';
      }
      case 'correctChunk': {
        if (!lastChunk || lastChunk.status === 'validated') return 'There is no draft take to correct — film the next chunk first.';
        const chunk = await filmCorrect(lastChunk.id, { aspects: {}, note: params.note || params.direction || '' });
        return chunk && chunk.status === 'draft'
          ? 'New take landed — check the timeline. Say “approve” to lock it and continue, or tell me what still bothers you.'
          : 'The retake didn\'t make it — the note above says why.';
      }
      case 'approveChunk': {
        if (!lastChunk || lastChunk.status !== 'draft') return 'Nothing to approve right now.';
        filmValidate(lastChunk.id);
        return 'Approved — the story continues from here. What happens next?';
      }
      case 'proposeBeats':
        return filmPropose();
      case 'inspiration': {
        adoptIdea(params.prompt);
        // Strip-launched "Explore the look" sends no prompt — seed it from the
        // premise so inspiration always has something to riff on.
        const inspPrompt = params.prompt || params.beat || projectRef.current?.idea || '';
        if (!inspPrompt.trim()) return 'Tell me what to riff on first — a premise, a mood, or a reference. Describe the idea, then explore the look.';
        await runAgent({ agentId: 'inspiration', settings: { ...AGENT_MAP.inspiration.defaultSettings, prompt: inspPrompt }, selectionNodes: selImages });
        return 'Inspiration board added — these are style/mood candidates, not cast. Next: tag the ONE look you love as Look (the “+ tag role” on its card), then draft the production — tagging scenes in mixed styles as cast makes an inconsistent film.';
      }
      case 'characterVariations': {
        const targets = selImages.length ? selImages : nodesForRole('talent');
        if (!targets.length) return 'Select your character on the board (or tag one as Talent in the bible) and ask again.';
        await runAgent({ agentId: 'characterVariations', settings: { ...AGENT_MAP.characterVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Character variations on the board. Tag the take you like as Talent — the strip up top moves with you.';
      }
      case 'locationVariations': {
        const targets = selImages.length ? selImages : nodesForRole('location');
        if (!targets.length) return 'Select a location on the board (or tag one in the bible) and ask again.';
        await runAgent({ agentId: 'locationVariations', settings: { ...AGENT_MAP.locationVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Location coverage on the board. Tag the angles you want as Location anchors.';
      }
      case 'mixMatch': {
        const character = selImages.find((n) => n.data?.bibleRole === 'talent' || n.data?.bibleRole === 'character') || selImages[0] || nodesForRole('talent')[0];
        if (!character) return 'I need your character — select them on the board or tag one as Talent.';
        const locations = selImages.filter((n) => n !== character);
        const locationUrls = bibleRef.current.filter((b) => b.role === 'location' && b.url).map((b) => b.url);
        await runAgent({ agentId: 'mixMatch', settings: { ...AGENT_MAP.mixMatch.defaultSettings, prompt: params.direction, locationUrls }, selectionNodes: [character, ...locations] });
        return 'Story moments staged — see what might be happening to them on the board. Tag a keeper — or “film this: …” to shoot one right now.';
      }
      case 'exploreTopic': {
        adoptIdea(params.prompt);
        await runAgent({ agentId: 'topicExplorer', settings: { ...AGENT_MAP.topicExplorer.defaultSettings, topic: params.prompt || projectRef.current?.idea || '' }, selectionNodes: [] });
        return 'Topic explored — concepts and candidates are on the board. Next: click the dashed “+ Hero?” / “+ Location?” chip on your favorite cards to lock them into the bible (your cast and world), then ask me “what could happen next?” — or describe the opening shot and I\'ll film the first 12 seconds.';
      }
      case 'classify': {
        const roles = await classifyBoardAssets();
        return roles.length
          ? `Sorted — ${roles.length} image${roles.length === 1 ? '' : 's'} tagged (${[...new Set(roles)].join(', ')}). Fix any role on its node badge.`
          : 'Nothing to sort — drop a few untagged images on the board first.';
      }
      case 'storyboard': {
        adoptIdea(params.prompt);
        // No anchors yet → don't dead-end: explain the pipeline and offer the next
        // step as a one-tap action (draft candidates; the user's tag makes them canon).
        if (!bibleRef.current.some((b) => b.url)) {
          return {
            say: 'Nothing is cast yet — a storyboard is drawn around real tagged images, so the same cast appears in every shot. First step: I can draft candidate characters and places from your idea; you tag the keepers (the dashed chip on each card), then I storyboard.',
            next: { action: 'castDraft', prompt: params.prompt, say: 'Draft the cast' },
          };
        }
        pushFilmNote('Reading your cast and breaking the film into shots — the cards appear first, then each photoreal frame composes in.');
        await runAgent({
          agentId: 'storyboard',
          settings: { ...AGENT_MAP.storyboard.defaultSettings, idea: params.prompt || projectRef.current?.idea || '', genre: projectRef.current?.genre?.line || '', bibleEntries: bibleRef.current },
          selectionNodes: [],
        });
        return 'Storyboard on the board — one SHOT card per shot: what happens, the camera template, a photoreal frame, and the real assets feeding it. Edit anything, shoot one card with its 🎬, or say “action” to shoot them all.';
      }
      case 'detectGenre': {
        // The genre detector: read genre & tone from the premise FIRST, surface it
        // as one-tap chips. Picking a chip locks the genre and runs castDraft — so
        // the highest-leverage creative call is made (and steerable) before any spend.
        const idea = (params.prompt || projectRef.current?.idea || '').trim();
        if (!idea) return 'Give me the film idea first — one sentence is enough.';
        adoptIdea(idea);
        traceRef.current.startRun({ note: 'Read genre' });
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
        const idea = (params.prompt || projectRef.current?.idea || '').trim();
        if (!idea) return 'Give me the film idea first — one sentence is enough.';
        adoptIdea(idea);
        traceRef.current.startRun({ note: 'Draft the production' });
        const castCtx = { client: traceRef.current.wrapClient(createBrowserClient((apiKey || '').trim())) };
        // Genre = the picked chip, else the project's, else a quick read (strip path).
        let genre = (params.genre || '').trim() || (projectRef.current?.genre?.line || '');
        if (!genre) { const g = await detectGenre({ idea }, castCtx); genre = [g.genre, g.tone].filter(Boolean).join(' · '); }
        onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? { ...prev, genre: { line: genre } } : prev));
        pushFilmNote(`Drafting as ${genre} — characters, places and a look render into the cards below.`);
        // The draft is up to 5 plates in a 4-wide grid — snap the whole block to
        // open space so a re-draft doesn't land on the previous one.
        const preferred = rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 180 }) : { x: 120, y: 120 };
        const origin = freeOrigin({ w: 4 * PLATE_COL_W, h: 2 * PLATE_ROW_H, preferred });
        const slotPos = (i) => ({ x: origin.x + (i % 4) * PLATE_COL_W, y: origin.y + Math.floor(i / 4) * PLATE_ROW_H });
        const slotIds = []; // plan index → placeholder node id, so each plate fills its own card
        const entries = await castFromIdea({ idea, genre }, castCtx, {
          // onPlan: drop a LOADING card per planned plate the instant the read returns,
          // so the board fills with spinners immediately instead of staying empty.
          onPlan: (specs) => {
            specs.forEach((s, i) => {
              const node = createAssetNode({ kind: 'image', url: '', label: s.name, position: slotPos(i), meta: { suggestedRole: s.role } });
              node.data.loading = true;
              slotIds[i] = node.id;
              setNodes((ns) => ns.concat(node));
            });
          },
          // onEntry: a plate finished (or failed) — fill its loading card, or drop the
          // card if it failed so no blank placeholder lingers.
          onEntry: (c, i) => {
            const id = slotIds[i];
            if (c.failed) { if (id) setNodes((ns) => ns.filter((n) => n.id !== id)); return; }
            if (id) {
              setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, url: c.url, loading: false } } : n)));
            } else {
              setNodes((ns) => ns.concat(createAssetNode({ kind: 'image', url: c.url, label: c.name, position: slotPos(i), meta: { suggestedRole: c.role } })));
            }
          },
        });
        return `${entries.length} candidate${entries.length === 1 ? '' : 's'} on the board — drafted from the idea, nothing is canon yet. Tap the dashed role chip on the keepers to lock them in, re-roll what you don't like (Character/Location Variations) — your tags move the pipeline strip forward.`;
      }
      case 'action': {
        if (!nodesRef.current.some((n) => n.type === 'cut')) return 'No cards to shoot yet — storyboard the film first (the strip button up top runs it).';
        handleAction(); // fire-and-forget: a multi-shot run takes minutes; the timeline shows progress
        return 'Rolling — shooting the cards in order. Watch the timeline fill in; cards already shot keep their takes.';
      }
      case 'stitch': {
        if (renderMovieRef.current) renderMovieRef.current();
        return 'Stitching the rendered shots into the final cut — it lands on the timeline (▶ to watch).';
      }
      case 'nextStep': {
        // "Continue" is deterministic: a draft take always comes first, then the
        // first unfinished pipeline stage — the LLM routed the word, nothing more.
        const draft = filmChunks[filmChunks.length - 1];
        if (draft && draft.status === 'draft') return 'A draft take is waiting on the timeline — say “approve” to lock it, or tell me what to fix.';
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
              say: 'Cast and places are locked — next is the storyboard: one SHOT card per 5–15s shot, every prompt visible before any video money is spent.',
              next: { action: 'storyboard', say: 'Storyboard it' },
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
  }, [filmChunks, filmGenerate, filmCorrect, filmValidate, filmPropose, runAgent, nodesForRole, classifyBoardAssets, handleAction, apiKey, onUpdateProject, rfInstance, setNodes, livePipeline, pushFilmNote, freeOrigin]);

  // handleRenderMovie is declared below (it reads live timeline state); the
  // dispatch above reaches it through this ref to avoid a declaration-order knot.
  const renderMovieRef = useRef(null);

  // The pipeline strip's one-click dispatch. No proposal round-trip: the chat
  // confirms because an LLM interpreted free text, but the strip's button is
  // already deterministic — its label IS the confirmation. Replies land in the
  // director chat, and as a toast when the chat is closed, so the strip never
  // works silently.
  const [stripBusy, setStripBusy] = useState(false);
  const runStripAction = useCallback(async (action, params = {}) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    setStripBusy(true);
    try {
      const out = await dispatchFilmAction(action, params);
      const text = typeof out === 'string' ? out : (out && out.say) || '';
      if (text) {
        pushFilmNote(text);
        if (!filmDockOpen) Message.info({ content: text, duration: 6000 });
      }
    } catch (err) {
      Message.error(err.message);
    } finally {
      setStripBusy(false);
    }
  }, [apiKey, dispatchFilmAction, pushFilmNote, filmDockOpen]);

  // ---- the Ad concierge's routed chat (same router, ad catalogue) ---------------
  // Free text typed BETWEEN the interview's own questions (gaps-idle / cuts-review /
  // done) routes here: "generate me X" → the right agent armed and proposed back;
  // a question → answered from the studio context. The dock confirms before any
  // generation runs; commands (makeAd/action/relayCuts) dispatch inside the dock.
  const routeConciergeMessage = useCallback(async (message, stageHint = '') => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return null; }
    const roles = AD_ROLES.map((r) => { const n = bibleRef.current.filter((b) => b.role === r).length; return n ? `${r}×${n}` : null; }).filter(Boolean).join(' ');
    const cuts = nodesRef.current.filter((n) => n.type === 'cut');
    const shotCuts = cuts.filter((c) => c.data?.shotUrl).length;
    const boardImages = nodesRef.current.filter((n) => n.data?.kind === 'image').length;
    const looks = Object.entries(LOOK_PACKAGES).map(([id, l]) => `${id} (${l.grade}; camera ${l.camera})`).join(' · ');
    const context = [
      `ad idea: ${(projectRef.current?.idea || '').replace(/\s+/g, ' ').trim().slice(0, 200) || '(none yet)'}`,
      `stage: ${stageHint || 'idle'}`,
      `brand kit (bible): ${roles || '(empty)'}`,
      cuts.length ? `CUT cards: ${cuts.length} laid${shotCuts ? `, ${shotCuts} already shot` : ''}` : 'CUT cards: none laid yet',
      `board: ${boardImages} image${boardImages === 1 ? '' : 's'}`,
      `selection: ${nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image').length} image(s)`,
      `available looks: ${looks}`,
    ].join(' · ');
    traceRef.current.startRun({ note: `Chat · “${message.replace(/\s+/g, ' ').trim().slice(0, 60)}”` });
    const rec = traceRef.current.log({ kind: 'route', prompt: message.slice(0, 160), status: 'running' });
    try {
      const ctx = { client: traceRef.current.wrapClient(createBrowserClient(apiKey.trim())) };
      const routed = await routeStudioAction({ message, context, actions: AD_ACTIONS }, ctx);
      rec.status = 'ok'; rec.result = routed ? routed.action : 'no read';
      return routed;
    } catch (err) {
      rec.status = 'error'; rec.error = err.message;
      return null;
    }
  }, [apiKey]);

  // Deterministic dispatch of a CONFIRMED concierge generation. Same resolution as
  // the film dispatch (selection first, then the matching bible anchor) but the
  // replies speak ad: outputs are candidates — tag a keeper, or feed it to a cut.
  const dispatchAdAction = useCallback(async (action, params = {}) => {
    const selImages = nodesRef.current.filter((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    switch (action) {
      case 'inspiration': {
        await runAgent({ agentId: 'inspiration', settings: { ...AGENT_MAP.inspiration.defaultSettings, prompt: params.prompt || params.direction }, selectionNodes: selImages });
        return 'Fresh candidates on the board. Tag a keeper with a role badge, or drop one straight onto a CUT card to feed that shot.';
      }
      case 'characterVariations': {
        const targets = selImages.length ? selImages : nodesForRole('talent');
        if (!targets.length) return 'I need a person to vary — select one on the board, or tag one as Talent first.';
        await runAgent({ agentId: 'characterVariations', settings: { ...AGENT_MAP.characterVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Variations on the board — same person, new takes. Tag the keeper, or drop one onto a CUT card.';
      }
      case 'locationVariations': {
        const targets = selImages.length ? selImages : nodesForRole('location');
        if (!targets.length) return 'I need a place to vary — select one on the board, or tag one as Location first.';
        await runAgent({ agentId: 'locationVariations', settings: { ...AGENT_MAP.locationVariations.defaultSettings, direction: params.direction }, selectionNodes: targets });
        return 'Location takes on the board. Tag the angles you want, or drop one onto a CUT card.';
      }
      case 'mixMatch': {
        const character = selImages.find((n) => n.data?.bibleRole === 'talent') || selImages[0] || nodesForRole('talent')[0];
        if (!character) return 'I need the person first — select them on the board, or tag one as Talent.';
        const locations = selImages.filter((n) => n !== character);
        const locationUrls = bibleRef.current.filter((b) => b.role === 'location' && b.url).map((b) => b.url);
        await runAgent({ agentId: 'mixMatch', settings: { ...AGENT_MAP.mixMatch.defaultSettings, prompt: params.direction, locationUrls }, selectionNodes: [character, ...locations] });
        return 'Staged moments on the board — your person in your places. Drop a winner onto a CUT card to use it.';
      }
      case 'exploreTopic': {
        await runAgent({ agentId: 'topicExplorer', settings: { ...AGENT_MAP.topicExplorer.defaultSettings, topic: params.prompt || projectRef.current?.idea || '' }, selectionNodes: [] });
        return 'Topic explored — concepts and candidate images are on the board, each with a suggested role chip. Your click makes them canon.';
      }
      case 'classify': {
        const roles = await classifyBoardAssets();
        return roles.length
          ? `Sorted — ${roles.length} image${roles.length === 1 ? '' : 's'} tagged (${[...new Set(roles)].join(', ')}). Fix any role on its node badge.`
          : 'Nothing to sort — drop a few untagged images on the board first.';
      }
      default:
        return "I don't know that move yet.";
    }
  }, [runAgent, nodesForRole, classifyBoardAssets]);

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
    idea: project.idea,
    bibleEntries,
    cutCards: nodes.filter((n) => n.type === 'cut').map((n) => ({ shotUrl: n.data?.shotUrl || '' })),
    filmUrl: timeline.film?.url || '',
    candidates: untaggedImageCount,
  }), [project.idea, bibleEntries, nodes, timeline.film, untaggedImageCount]);
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
          ? `${s.label} ✓ — next: ${next.label.toLowerCase()}. The strip button up top runs it whenever you're ready.`
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
    setFilmChunks([]);
    setFilmStage('');
    setFilmProgress(null);
    setFilmBusy(false);
    setSelectedEventId(null);
    setActiveLayerId(null);
    filmingRef.current = null;
    chunkStageRef.current = new Map();
    stagePrevRef.current = null;
    sessionRef.current = null;
    sessionStateRef.current = null;
    outNodesRef.current = new Map();
    setFilmDockOpen(false);
    onUpdateProject((prev) => (prev && prev.id === loadedIdRef.current ? {
      ...prev,
      recipe: null, // back to the launcher — "What are we making?"
      idea: '',
      genre: null,
      bible: emptyBible(),
      timeline: emptyTimeline(),
      filming: { chunks: [] },
      auto: null,
      canvas: { ...(prev.canvas || {}), nodes: [], edges: [] },
    } : prev));
    // No toast — the launcher reappearing is the feedback.
  }, [setNodes, setEdges, onUpdateProject]);

  // Pass tagNode + the heal hook to board AssetNodes through context (functions
  // can't live in serializable node.data).
  const tagCtx = useMemo(() => ({ onTagRole: tagNode, onImgError: healNodeUrl }), [tagNode, healNodeUrl]);

  return (
    <AssetNodeContext.Provider value={tagCtx}>
    <CutContext.Provider value={cutCtx}>
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
        {/* Floating toolbar */}
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
          <Space>
            <Tooltip content="Add images, video or audio from your computer">
              <Button size="small" type="primary" icon={<IconUpload />} onClick={() => fileInputRef.current?.click()}>Add</Button>
            </Tooltip>
            <Tooltip content="Library — your checked-in assets (drag onto the board)">
              <Button size="small" type={libraryOpen ? 'primary' : 'default'} icon={<IconStorage />} onClick={() => setLibraryOpen((v) => !v)}>Library</Button>
            </Tooltip>
            <Tooltip content="Decision history — every prompt, reference & decision each agent made (fully transparent)">
              <Button size="small" type={historyOpen ? 'primary' : 'default'} icon={<IconHistory />} onClick={() => setHistoryOpen((v) => !v)}>History</Button>
            </Tooltip>
            <Button size="small" icon={<IconPlus />} onClick={addNote}>Note</Button>
            <Tooltip content="Lock selected (use as canonical reference)">
              <Button size="small" icon={<IconLock />} disabled={!selectionCount} onClick={() => setLockOnSelection(true)} />
            </Tooltip>
            <Tooltip content="Unlock selected">
              <Button size="small" icon={<IconUnlock />} disabled={!selectionCount} onClick={() => setLockOnSelection(false)} />
            </Tooltip>
            <Tooltip content="Delete selected">
              <Button size="small" status="danger" icon={<IconDelete />} disabled={!selectionCount} onClick={deleteSelection} />
            </Tooltip>
            <Tooltip content="Check in selected — save permanently to your storage (beats the 24h expiry)">
              <Button size="small" icon={<IconCloudDownload />} disabled={!selectionCount} onClick={preserveSelection}>Check in</Button>
            </Tooltip>
            <Tooltip content="Fit view">
              <Button size="small" icon={<IconFullscreen />} onClick={() => rfInstance?.fitView({ padding: 0.2 })} />
            </Tooltip>
          </Space>
        </div>

        {/* The pipeline strip — the explicit Film pipeline rendered ON the board,
            current stage carrying its action button. The forward path lives here;
            the director chat is for free-form direction, never a required ritual. */}
        {filmMode && (
          <PipelineStrip
            pipeline={filmPipeline}
            busy={stripBusy || filmBusy || autoFillBusy}
            busyLabel={filmStage || ''}
            onAction={runStripAction}
            onOpenDirector={() => setFilmDockOpen(true)}
          />
        )}

        {/* The Concierge as an on-canvas DOCK (not a modal — modals fight the canvas).
            "New ad" toggles it; it's board-driven: classify tags board nodes, gaps drop
            pre-tagged nodes, Generate kicks the existing Auto-fill path. */}
        {conciergeOpen && (
          <ConciergeDock
            apiKey={apiKey}
            idea={project.idea}
            recipe={project.recipe}
            bibleEntries={bibleEntries}
            untaggedImageCount={untaggedImageCount}
            producing={autoFillBusy}
            onClose={onCloseConcierge}
            onClassify={classifyBoardAssets}
            onGenerateGap={generateGapNode}
            onUploadGap={addTaggedAsset}
            onUpdateBrief={handleBriefUpdate}
            onReadIntent={readIntentForIdea}
            onGenerateAd={handleGenerateAd}
            onAction={handleAction}
            onRoute={routeConciergeMessage}
            onDispatchRouted={dispatchAdAction}
            traceCount={traceRef.current.entries.length}
            onCopyTrace={copyTrace}
            onDownloadTrace={downloadTrace}
          />
        )}

        {/* Film mode's conversational director — say it, confirm it, it runs. */}
        {filmMode && filmDockOpen && (
          <FilmDock
            onReset={resetFilm}
            onRoute={routeFilmMessage}
            onDispatch={dispatchFilmAction}
            filming={{
              busy: filmBusy,
              stage: filmStage,
              // An unapproved take survives the dock closing (takes cost money —
              // chat resets, the film doesn't); the greeting names it explicitly.
              draft: (() => { const c = filmChunks[filmChunks.length - 1]; return c && c.status === 'draft' ? c.beat : ''; })(),
            }}
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
        {/* Ad projects get the same reopen affordance (the header "New ad" button is
            gone — the launcher card starts a project; this resumes its concierge). */}
        {!filmMode && project.recipe?.id === ADVERTISEMENT_RECIPE.id && !conciergeOpen && (
          <Button
            size="small"
            type="primary"
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 8, background: '#5a3df0', borderColor: '#5a3df0' }}
            onClick={() => onOpenConcierge && onOpenConcierge()}
          >
            ⚡ Concierge
          </Button>
        )}
        {/* The third path: the user brought their OWN assets first (board not empty,
            no recipe chosen, no dock open) — the launcher cards are gone, so this is
            the conversational entry that would otherwise not exist anywhere. */}
        {!project.recipe && !conciergeOpen && !filmDockOpen && nodes.length > 0 && (
          <Dropdown
            position="br"
            droplist={(
              <Menu onClickMenuItem={(key) => (key === 'shortFilm' ? startShortFilm() : (onOpenConcierge && onOpenConcierge()))}>
                {Object.values(RECIPES).map((r) => (
                  <Menu.Item key={r.id}>{r.emoji} {r.label}</Menu.Item>
                ))}
              </Menu>
            )}
          >
            <Button size="small" type="primary" style={{ position: 'absolute', top: 12, right: 12, zIndex: 8, background: '#5a3df0', borderColor: '#5a3df0' }}>
              ✨ What are we making?
            </Button>
          </Dropdown>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          style={{ display: 'none' }}
          onChange={onPickFiles}
        />

        {/* Template launcher — the empty board IS the front door (Higgsfield/Luma
            style): pick a recipe card → the concierge agent opens and interviews you.
            One door, not two — no separate "what's your film about?" card. Hidden as
            soon as anything is on the board or the dock is already open. */}
        {/* Hidden the moment either dock is open OR a recipe is already chosen —
            "what are we making?" is an answered question then. */}
        {nodes.length === 0 && !conciergeOpen && !filmDockOpen && !project.recipe ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 6 }}>
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 720, padding: '0 16px' }}>
              <Text style={{ fontSize: 17, fontWeight: 700 }}>What are we making?</Text>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {Object.values(RECIPES).map((r) => (
                  <div
                    key={r.id}
                    onClick={() => (r.id === SHORT_FILM_RECIPE.id ? startShortFilm() : (onOpenConcierge && onOpenConcierge()))}
                    style={{ width: 250, background: '#fff', border: '1px solid #e5e6eb', borderRadius: 12, boxShadow: '0 4px 18px rgba(0,0,0,0.08)', padding: 18, cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 26, marginBottom: 6 }}>{r.emoji || '🎬'}</div>
                    <Text style={{ fontSize: 14, fontWeight: 700, display: 'block', marginBottom: 4 }}>{r.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>{r.description || ''}</Text>
                    <Button type="primary" size="small" style={{ background: '#5a3df0', borderColor: '#5a3df0' }}>Start →</Button>
                  </div>
                ))}
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
          onEdgesChange={onEdgesChange}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']}
          // Empty board → left-drag PANS (so you can actually navigate). Once there
          // are assets, left-drag selects (the marquee that runs an agent), and you
          // pan with middle-mouse / trackpad-scroll. Right-click always opens the menu.
          selectionOnDrag={nodes.length > 0}
          selectionMode={SelectionMode.Partial}
          panOnDrag={nodes.length > 0 ? [1] : [0, 1]}
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
          <Controls position="top-left" style={{ top: 50, left: 10 }} showInteractive={false} />
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
          running={running}
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
