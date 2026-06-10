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
import { Button, Message, Space, Typography, Tooltip } from '@arco-design/web-react';
import {
  IconPlus,
  IconLock,
  IconUnlock,
  IconDelete,
  IconFullscreen,
  IconCloudDownload,
  IconStorage,
  IconUpload,
} from '@arco-design/web-react/icon';
import AssetNode from './AssetNode';
import GroupNode from './GroupNode';
import LayerRail from './LayerRail';
import LayerPanel from './LayerPanel';
import CanvasContextMenu from './CanvasContextMenu';
import LibraryPanel from './LibraryPanel';
import StoryDirectorPanel from './StoryDirectorPanel';
import StoryTimeline from './StoryTimeline';
import AutoPlanNode from './AutoPlanNode';
import AutoDirectorPanel from './AutoDirectorPanel';
import { AutoDirectorContext } from './AutoDirectorContext';
import { AGENT_MAP, AGENTS, AGENT_COLORS, suggestNextBeats, understandAssets, buildPlan, qcStep } from '../../../utils/film/agents';
import {
  createAssetNode,
  originFromSelection,
  fileToAssetKind,
  readFileAsDataUrl,
  serializeNodes,
  preserveAsset,
  stageLocalAsset,
  makeThumbnail,
  createGroupNode,
} from '../../../utils/film/canvasModel';
import { listLibrary, addToLibrary, removeFromLibrary, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

const nodeTypes = { asset: AssetNode, group: GroupNode, autoPlan: AutoPlanNode };

// Restore a persisted Auto Director plan: drop one that never finished planning,
// and reset any in-flight step (no async task survives a reload) so it can re-run.
const rehydrateAutoPlan = (auto) => {
  if (!auto || typeof auto !== 'object') return null;
  if (auto.status === 'understanding' || auto.status === 'planning') return null;
  const steps = (auto.steps || []).map((s) => (
    (s.status === 'running' || s.status === 'qc') ? { ...s, status: 'pending' } : s
  ));
  return { ...auto, steps, busy: null, status: auto.status === 'assembling' ? 'running' : auto.status };
};

const CELL_W = 240;
const CELL_H = 290;
const GROUP_PAD = 12;
const GROUP_HEADER = 34;

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

const FilmCanvasInner = ({ project, apiKey, onUpdateProject }) => {
  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);

  const initialLayerState = useMemo(() => buildInitialLayerState(project), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layerSettings, setLayerSettings] = useState(initialLayerState.settings);
  const [layerVisibility, setLayerVisibility] = useState(initialLayerState.visibility);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    applyVisibility(project.canvas?.nodes || [], initialLayerState.visibility),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(project.canvas?.edges || []);

  // Default-arm the Inspiration Board so its panel is visible on arrival — the
  // primary "generate your first references" action is immediately discoverable.
  const [activeLayerId, setActiveLayerId] = useState('inspiration');
  const [running, setRunning] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } in wrapper-relative px
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState([]);
  const [storySuggestions, setStorySuggestions] = useState([]);
  const [storyBusy, setStoryBusy] = useState(null); // 'suggesting' | 'generating' | null
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [autoPlan, setAutoPlan] = useState(() => rehydrateAutoPlan(project.auto)); // Auto Director production plan

  const loadedIdRef = useRef(project.id);
  const originOverride = useRef(null); // flow-coords origin captured from a right-click
  const autoRef = useRef(autoPlan);    // latest plan for the async executor
  const nodesRef = useRef(nodes);      // latest nodes for input resolution
  useEffect(() => { autoRef.current = autoPlan; }, [autoPlan]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Re-initialize everything when the project actually changes (switch / open).
  useEffect(() => {
    if (loadedIdRef.current === project.id) return;
    loadedIdRef.current = project.id;
    const ls = buildInitialLayerState(project);
    setLayerSettings(ls.settings);
    setLayerVisibility(ls.visibility);
    setNodes(applyVisibility(project.canvas?.nodes || [], ls.visibility));
    setAutoPlan(rehydrateAutoPlan(project.auto));
    setActiveLayerId('inspiration');
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
          auto: autoPlan,
        };
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [nodes, edges, layerSettings, layerVisibility, autoPlan]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const removeLibraryItem = useCallback(async (item) => {
    setLibraryItems(await removeFromLibrary({ id: item.id, url: item.url }));
  }, []);

  // ---- Story Director (interactive, linear) ----
  const STORY_COLOR = AGENT_COLORS.storyDirector;

  const storyNodes = useMemo(
    () => nodes.filter((n) => n.data?.storyOrder != null).sort((a, b) => a.data.storyOrder - b.data.storyOrder),
    [nodes],
  );
  const storyStarted = storyNodes.length > 0;
  const storySteps = useMemo(() => storyNodes.map((n) => n.data.event || 'Beat'), [storyNodes]);

  const requestSuggestions = useCallback(async (stepsOverride, lastUrl) => {
    if (!apiKey?.trim()) return;
    setStoryBusy('suggesting');
    setStorySuggestions([]);
    try {
      const beats = await suggestNextBeats({
        apiKey: apiKey.trim(),
        idea: project.idea,
        steps: stepsOverride,
        lastImageUrl: lastUrl || null,
        count: 3,
      });
      setStorySuggestions(beats);
    } catch (err) {
      Message.error(err.message);
    } finally {
      setStoryBusy(null);
    }
  }, [apiKey, project.idea]);

  const appendStoryNode = useCallback(({ url, localUrl, assetId, event, order, prevId, baseline }) => {
    const pos = { x: baseline.x + order * 300, y: baseline.y };
    const node = createAssetNode({ kind: 'image', url, label: event, position: pos, layerId: 'storyDirector', preserved: !!assetId });
    node.data.storyOrder = order;
    node.data.event = event;
    // Carry the local bytes for uploaded sources so the keyframe renders (the TOS
    // URL would 403) and isn't mistaken for an expired generated asset.
    if (localUrl) node.data.localUrl = localUrl;
    if (assetId) node.data.assetId = assetId;
    node.data.visibility = layerVisibility.storyDirector || 'show';
    setNodes((ns) => ns.concat(node));
    if (prevId) {
      setEdges((es) => es.concat({
        id: `e-${prevId}-${node.id}`,
        source: prevId,
        target: node.id,
        animated: true,
        style: { stroke: STORY_COLOR, strokeWidth: 2 },
      }));
    }
    return node;
  }, [setNodes, setEdges, STORY_COLOR, layerVisibility]);

  const generateStoryBeat = useCallback(async (prompt, title) => {
    if (!apiKey?.trim()) { Message.error('Add your API key first'); return; }
    const ordered = nodes.filter((n) => n.data?.storyOrder != null).sort((a, b) => a.data.storyOrder - b.data.storyOrder);
    const prev = ordered[ordered.length - 1];
    const order = prev ? prev.data.storyOrder + 1 : 0;
    const node0 = ordered.find((n) => n.data.storyOrder === 0);
    const baseline = node0
      ? { x: node0.position.x, y: node0.position.y }
      : (rfInstance ? rfInstance.screenToFlowPosition({ x: 160, y: 220 }) : { x: 160, y: 220 });
    setStoryBusy('generating');
    setStorySuggestions([]);
    try {
      const res = await fetch('/api/film/imagine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), prompt, referenceImages: prev?.data?.url ? [refUrl(prev)] : [], size: '2K' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || 'Keyframe generation failed');
      appendStoryNode({ url: data.url, event: title, order, prevId: prev?.id, baseline });
      const nextSteps = [...ordered.map((n) => n.data.event || 'Beat'), title];
      await requestSuggestions(nextSteps, data.url);
    } catch (err) {
      Message.error(err.message);
    } finally {
      setStoryBusy(null);
    }
  }, [apiKey, nodes, rfInstance, appendStoryNode, requestSuggestions]);

  const startStoryFromSelection = useCallback(async () => {
    const sel = nodes.find((n) => n.selected && n.data?.kind === 'image' && n.data?.url);
    if (!sel) { Message.warning('Select an image to start from'); return; }
    const baseline = rfInstance ? rfInstance.screenToFlowPosition({ x: 160, y: 220 }) : { x: 160, y: 220 };
    appendStoryNode({ url: sel.data.url, localUrl: sel.data.localUrl, assetId: sel.data.assetId, event: 'Start', order: 0, prevId: null, baseline });
    // Use the base64 for uploads — the TOS URL would 403 when Seed fetches it.
    await requestSuggestions(['Start'], refUrl(sel));
  }, [nodes, rfInstance, appendStoryNode, requestSuggestions]);

  const startStoryFromIdea = useCallback(async () => {
    await generateStoryBeat(project.idea || 'Establishing opening shot of the film', 'Start');
  }, [generateStoryBeat, project.idea]);

  // Drop a board asset / Library item onto the timeline → append it as the next beat.
  const addAssetToStory = useCallback(({ url, assetId, label }) => {
    if (!url) return;
    const ordered = nodes.filter((n) => n.data?.storyOrder != null).sort((a, b) => a.data.storyOrder - b.data.storyOrder);
    const prev = ordered[ordered.length - 1];
    const order = prev ? prev.data.storyOrder + 1 : 0;
    const node0 = ordered.find((n) => n.data.storyOrder === 0);
    const baseline = node0
      ? { x: node0.position.x, y: node0.position.y }
      : (rfInstance ? rfInstance.screenToFlowPosition({ x: 160, y: 220 }) : { x: 160, y: 220 });
    appendStoryNode({ url, assetId: assetId || null, event: label || `Beat ${order + 1}`, order, prevId: prev?.id, baseline });
    Message.success('Added to timeline');
  }, [nodes, rfInstance, appendStoryNode]);

  const selectAndCenter = useCallback((id) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    if (rfInstance) {
      try { rfInstance.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1, padding: 0.5 }); } catch { /* noop */ }
    }
  }, [setNodes, rfInstance]);

  const timelineItems = useMemo(
    () => storyNodes.map((n) => ({ id: n.id, url: n.data.localUrl || n.data.url, event: n.data.event, order: n.data.storyOrder })),
    [storyNodes],
  );

  // ---- preserve (check-in) ----
  // Re-host a node's expiring URL into TOS and swap data.url to the stable URL,
  // so the thumbnail and every downstream reference stop relying on the 24h URL.
  // Preserved assets are also added to the cross-project Library.
  const preserveNode = useCallback(async (node) => {
    if (!node || node.data?.kind !== 'image' || !node.data?.url) return node?.data?.url;
    if (node.data?.preserved) return node.data.url;
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, preserving: true } } : n)));
    try {
      const { url: stableUrl, assetId } = await preserveAsset(node.data.url, node.data.label);
      setNodes((ns) => ns.map((n) => (n.id === node.id
        ? { ...n, data: { ...n.data, url: stableUrl, tosUrl: stableUrl, assetId, preserved: true, preserving: false, expired: false } }
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
  const runAgent = useCallback(async ({ agentId, settings = {}, selectionNodes = [], origin, groupLabel }) => {
    const layer = AGENT_MAP[agentId];
    if (!layer) throw new Error(`Unknown agent: ${agentId}`);
    const fallback = rfInstance ? rfInstance.screenToFlowPosition({ x: 220, y: 160 }) : { x: 160, y: 160 };
    const baseOrigin = origin || originFromSelection(selectionNodes, fallback);
    const cellH = cellHeightForRatio(settings.ratio);

    // Batch agents drop their outputs into one titled group frame (a "panel").
    let groupId = null;
    let groupCols = 4;
    if (layer.grouped) {
      const count = Math.min(Math.max(Number(settings.count) || 6, 1), 12);
      groupCols = Math.min(count, 4);
      const rows = Math.ceil(count / groupCols);
      const width = GROUP_PAD * 2 + groupCols * CELL_W;
      const height = GROUP_HEADER + GROUP_PAD + rows * cellH;
      const promptLabel = (groupLabel || settings.prompt || settings.axis || '').toString().slice(0, 36);
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

    const outputs = [];           // [{ id, url, kind, label }] — live, async urls filled on resolve
    const outById = {};
    const pending = [];           // promises for async (video) assets
    const settle = {};            // nodeId -> resolver

    const result = await layer.run({
      prompt: settings.prompt,
      selection: selectionNodes,
      settings,
      apiKey,
      onAsset: (spec) => {
        const { position, parentId, extent } = placeNext();
        const node = createAssetNode({ ...spec, position });
        if (parentId) { node.parentId = parentId; node.extent = extent; }
        node.data.visibility = layerVisibility[spec.layerId] || 'show';
        const rec = { id: node.id, url: spec.url, kind: spec.kind || 'image', label: spec.label };
        outputs.push(rec); outById[node.id] = rec;
        setNodes((ns) => ns.concat(node));
        return node.id;
      },
      onPendingAsset: (spec) => {
        const { position, parentId, extent } = placeNext();
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

    const done = pending.length ? Promise.all(pending) : Promise.resolve([]);
    return { groupId, outputIds: outputs.map((o) => o.id), outputs, result, done };
  }, [rfInstance, apiKey, layerVisibility, setNodes]);

  const handleRun = useCallback(async () => {
    const layer = AGENT_MAP[activeLayerId];
    if (!layer) return;
    const selNodes = nodes.filter((n) => n.selected);
    const origin = originOverride.current || undefined;
    originOverride.current = null;
    setRunning(true);
    try {
      const { result } = await runAgent({ agentId: activeLayerId, settings: activeSettings, selectionNodes: selNodes, origin });
      // Manual run is fire-and-forget for async video — don't block on `done`.
      Message.success(result?.async
        ? `${layer.label} started — the shot is cooking on the board`
        : `${layer.label} finished`);
    } catch (err) {
      Message.error(err.message);
    } finally {
      setRunning(false);
    }
  }, [activeLayerId, activeSettings, nodes, runAgent]);

  // ---- Auto Director (orchestrator) -------------------------------------------
  const advanceAutoRef = useRef(null);
  const stitchAutoRef = useRef(null);

  const patchAutoStep = useCallback((id, patch) => {
    setAutoPlan((p) => (p ? { ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) } : p));
  }, []);

  // Source assets for the plan: selected images, else all image assets on board.
  const gatherAutoSources = useCallback(() => {
    const imgs = nodesRef.current.filter((n) => n.data?.kind === 'image' && n.data?.url && n.type !== 'autoPlan');
    const sel = imgs.filter((n) => n.selected);
    return sel.length ? sel : imgs;
  }, []);

  const startAutoDirector = useCallback(async () => {
    if (!apiKey?.trim()) { Message.error('Add your API key first (⚙ far-left)'); return; }
    if (autoRef.current) { Message.info('A plan already exists — discard it first.'); return; }
    const source = gatherAutoSources();
    const sourceIds = source.map((n) => n.id);
    const images = source.map(refUrl).filter(Boolean);
    const center = rfInstance ? rfInstance.screenToFlowPosition({ x: 60, y: 60 }) : { x: 40, y: 40 };
    const nodeId = `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setNodes((ns) => ns.concat({ id: nodeId, type: 'autoPlan', position: center, data: { kind: 'autoPlan' } }));
    setAutoPlan({ nodeId, status: 'understanding', brief: null, steps: [], cursor: 0, mode: 'review', busy: 'understanding', sourceIds, filmUrl: null, error: null });
    try {
      const brief = await understandAssets({ apiKey: apiKey.trim(), images, idea: project.idea });
      setAutoPlan((p) => (p ? { ...p, brief, status: 'planning', busy: 'planning' } : p));
      const rawSteps = await buildPlan({ apiKey: apiKey.trim(), brief, idea: project.idea, targetMinutes: project.targetMinutes });
      if (!rawSteps.length) throw new Error('The planner returned no steps — adjust the idea and try again.');
      const steps = rawSteps.map((s) => ({ ...s, gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null }));
      setAutoPlan((p) => (p ? { ...p, steps, status: 'review-plan', busy: null } : p));
    } catch (err) {
      setAutoPlan((p) => (p ? { ...p, status: 'error', error: err.message, busy: null } : p));
    }
  }, [apiKey, gatherAutoSources, rfInstance, project.idea, project.targetMinutes, setNodes]);

  const replanAuto = useCallback(async () => {
    const p0 = autoRef.current;
    if (!p0 || !apiKey?.trim()) return;
    setAutoPlan((p) => (p ? { ...p, busy: 'planning', status: 'planning' } : p));
    try {
      const rawSteps = await buildPlan({ apiKey: apiKey.trim(), brief: p0.brief, idea: project.idea, targetMinutes: project.targetMinutes });
      const steps = rawSteps.map((s) => ({ ...s, gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null }));
      setAutoPlan((p) => (p ? { ...p, steps, status: 'review-plan', busy: null } : p));
    } catch (err) {
      setAutoPlan((p) => (p ? { ...p, status: 'review-plan', busy: null } : p));
      Message.error(err.message);
    }
  }, [apiKey, project.idea, project.targetMinutes]);

  // ---- plan editing ----
  const autoRemoveStep = useCallback((id) => setAutoPlan((p) => (p ? { ...p, steps: p.steps.filter((s) => s.id !== id) } : p)), []);
  const autoMoveStep = useCallback((id, dir) => setAutoPlan((p) => {
    if (!p) return p;
    const i = p.steps.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.steps.length) return p;
    const steps = p.steps.slice();
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...p, steps };
  }), []);
  const autoAddStep = useCallback((agent) => {
    if (!agent) return;
    const meta = AGENT_MAP[agent];
    setAutoPlan((p) => (p ? { ...p, steps: p.steps.concat({
      id: `st-${Math.random().toString(36).slice(2, 9)}`,
      agent, title: meta?.label || agent, intent: '', params: { ...(meta?.defaultSettings || {}) },
      dependsOn: [], gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null,
    }) } : p));
  }, []);
  const autoToggleGate = useCallback((id) => patchAutoStep(id, (s) => ({ gated: !s.gated })), [patchAutoStep]);
  const autoSetMode = useCallback((mode) => setAutoPlan((p) => (p ? { ...p, mode } : p)), []);

  // Resolve a step's input nodes: approved deps' keepers, else the source assets.
  const resolveAutoInputs = useCallback((step) => {
    const p = autoRef.current;
    if (!p) return [];
    let ids;
    if (step.dependsOn?.length) {
      ids = step.dependsOn.flatMap((depId) => {
        const dep = p.steps.find((s) => s.id === depId);
        if (!dep) return [];
        return dep.pickedId ? [dep.pickedId] : (dep.outputs || []).map((o) => o.id);
      });
    } else {
      ids = p.sourceIds || [];
    }
    return nodesRef.current.filter((n) => ids.includes(n.id));
  }, []);

  // Run one step's agent + QC; leaves it at 'review'. Returns the QC verdict.
  const executeAutoStep = useCallback(async (stepId) => {
    const p = autoRef.current;
    const step = p?.steps.find((s) => s.id === stepId);
    if (!step) return null;
    const inputNodes = resolveAutoInputs(step);
    const planNode = nodesRef.current.find((n) => n.id === p.nodeId);
    // Cascade each step's output group down-right of the plan so they don't overlap.
    const stepIndex = Math.max(0, p.steps.findIndex((s) => s.id === stepId));
    const origin = planNode ? { x: planNode.position.x + 420 + stepIndex * 120, y: planNode.position.y + stepIndex * 320 } : undefined;
    patchAutoStep(stepId, { status: 'running', error: null });
    setAutoPlan((pp) => (pp ? { ...pp, busy: 'running-step' } : pp));
    try {
      const { outputs, done } = await runAgent({ agentId: step.agent, settings: step.params, selectionNodes: inputNodes, origin, groupLabel: step.title });
      await done; // wait for async (video) outputs to finalize
      const live = outputs.filter((o) => o.url);
      if (outputs.length && live.length === 0) throw new Error('Outputs failed to generate.');
      patchAutoStep(stepId, { status: 'qc', outputs: live.map((o) => ({ ...o })) });
      const references = inputNodes.map(refUrl).filter(Boolean);
      const imgOuts = live.filter((o) => o.kind !== 'video').map((o) => o.url);
      const vid = live.find((o) => o.kind === 'video')?.url;
      const qc = await qcStep({ apiKey: apiKey.trim(), agent: step.agent, intent: step.intent, references, outputs: imgOuts, video: vid });
      const pickedId = live[qc.best]?.id || live[0]?.id || null;
      patchAutoStep(stepId, { status: 'review', qc, pickedId, outputs: live.map((o) => ({ ...o })) });
      setAutoPlan((pp) => (pp ? { ...pp, busy: null } : pp));
      return qc;
    } catch (err) {
      patchAutoStep(stepId, { status: 'failed', error: err.message });
      setAutoPlan((pp) => (pp ? { ...pp, busy: null } : pp));
      return null;
    }
  }, [apiKey, patchAutoStep, resolveAutoInputs, runAgent]);

  // After a step reaches 'review': pause (gated / review mode / QC fail) or auto-advance.
  const settleAutoStep = useCallback((step, qc) => {
    const p = autoRef.current;
    if (!p) return;
    const mustPause = p.mode === 'review' || step.gated || !qc || qc.verdict === 'fail';
    if (mustPause) return; // leave at 'review' for the human
    patchAutoStep(step.id, { status: 'approved' });
    if (advanceAutoRef.current) advanceAutoRef.current(step.id);
  }, [patchAutoStep]);

  const runAutoStep = useCallback(async (stepId) => {
    const qc = await executeAutoStep(stepId);
    const step = autoRef.current?.steps.find((s) => s.id === stepId);
    if (step) settleAutoStep(step, qc);
  }, [executeAutoStep, settleAutoStep]);

  // Advance past a step: move the cursor to the next one; if none → assemble.
  const advanceAuto = useCallback((fromId) => {
    const p = autoRef.current;
    if (!p) return;
    const idx = p.steps.findIndex((s) => s.id === fromId);
    const nextIdx = idx + 1;
    if (nextIdx >= p.steps.length) {
      setAutoPlan((pp) => (pp ? { ...pp, status: 'assembling' } : pp));
      if (stitchAutoRef.current) stitchAutoRef.current();
      return;
    }
    setAutoPlan((pp) => (pp ? { ...pp, cursor: nextIdx } : pp));
    const next = p.steps[nextIdx];
    if (p.mode === 'auto' && next.status === 'pending') runAutoStep(next.id);
  }, [runAutoStep]);
  useEffect(() => { advanceAutoRef.current = advanceAuto; }, [advanceAuto]);

  const startAutoRun = useCallback(() => {
    const p = autoRef.current;
    if (!p || !p.steps.length) return;
    setAutoPlan((pp) => (pp ? { ...pp, status: 'running', cursor: 0 } : pp));
    if (p.mode === 'auto') runAutoStep(p.steps[0].id);
  }, [runAutoStep]);

  const autoPickOutput = useCallback((stepId, outId) => patchAutoStep(stepId, { pickedId: outId }), [patchAutoStep]);
  const autoApproveStep = useCallback((stepId) => { patchAutoStep(stepId, { status: 'approved' }); advanceAuto(stepId); }, [patchAutoStep, advanceAuto]);
  const autoRegenStep = useCallback((stepId) => { runAutoStep(stepId); }, [runAutoStep]);
  const autoSkipStep = useCallback((stepId) => { patchAutoStep(stepId, { status: 'skipped' }); advanceAuto(stepId); }, [patchAutoStep, advanceAuto]);

  const autoTakeOver = useCallback(() => {
    setAutoPlan(null);
    setNodes((ns) => ns.filter((n) => n.type !== 'autoPlan'));
    Message.info('Auto Director off — your assets stay on the board.');
  }, [setNodes]);

  // Stitch the approved animated shots into a final cut (server ffmpeg).
  const stitchAuto = useCallback(async () => {
    // Capture the LATEST committed plan via the updater (autoRef can lag a render,
    // which would drop a just-approved final shot), and flip to 'assembling'.
    let p = null;
    setAutoPlan((pp) => { p = pp; return pp ? { ...pp, status: 'assembling', busy: 'stitching' } : pp; });
    if (!p) return;
    const shots = [];
    p.steps.forEach((s) => {
      if (s.status !== 'approved') return;
      const keeper = (s.outputs || []).find((o) => o.id === s.pickedId) || (s.outputs || [])[0];
      if (keeper && keeper.kind === 'video' && keeper.url) shots.push(keeper.url);
    });
    if (shots.length === 0) {
      setAutoPlan((pp) => (pp ? { ...pp, status: 'done', busy: null } : pp));
      Message.info('No animated shots to stitch — approve some Animate steps first.');
      return;
    }
    try {
      const res = await fetch('/api/film/stitch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), shots, name: project.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details || data?.error || 'Stitch failed');
      const planNode = nodesRef.current.find((n) => n.id === p.nodeId);
      const pos = planNode ? { x: planNode.position.x, y: planNode.position.y + 560 } : { x: 60, y: 600 };
      const filmNode = createAssetNode({ kind: 'video', url: data.url, label: 'Film — final cut', position: pos, layerId: 'autoDirector', preserved: !!data.assetId });
      if (data.assetId) filmNode.data.assetId = data.assetId;
      setNodes((ns) => ns.concat(filmNode));
      setAutoPlan((pp) => (pp ? { ...pp, status: 'done', busy: null, filmUrl: data.url } : pp));
      Message.success('Final cut assembled');
    } catch (err) {
      setAutoPlan((pp) => (pp ? { ...pp, status: 'done', busy: null } : pp));
      Message.error(`Stitch failed: ${err.message}`);
    }
  }, [apiKey, project.title, setNodes]);
  useEffect(() => { stitchAutoRef.current = stitchAuto; }, [stitchAuto]);

  const autoActions = useMemo(() => ({
    replan: replanAuto,
    editStep: patchAutoStep,
    removeStep: autoRemoveStep,
    moveStep: autoMoveStep,
    addStep: autoAddStep,
    toggleGate: autoToggleGate,
    setMode: autoSetMode,
    start: startAutoRun,
    runStep: runAutoStep,
    pickOutput: autoPickOutput,
    approveStep: autoApproveStep,
    regenStep: autoRegenStep,
    skipStep: autoSkipStep,
    stitch: stitchAuto,
    takeOver: autoTakeOver,
    discard: autoTakeOver,
  }), [replanAuto, patchAutoStep, autoRemoveStep, autoMoveStep, autoAddStep, autoToggleGate, autoSetMode, startAutoRun, runAutoStep, autoPickOutput, autoApproveStep, autoRegenStep, autoSkipStep, stitchAuto, autoTakeOver]);

  const autoContextValue = useMemo(() => ({ plan: autoPlan, actions: autoActions, apiKey }), [autoPlan, autoActions, apiKey]);

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

  return (
    <AutoDirectorContext.Provider value={autoContextValue}>
    <div style={{ display: 'flex', height: '72vh', border: '1px solid #e5e6eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
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
          onRemove={removeLibraryItem}
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

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          style={{ display: 'none' }}
          onChange={onPickFiles}
        />

        {/* Empty-state hint */}
        {nodes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 1 }}>
            <div style={{ textAlign: 'center', maxWidth: 420 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
              <Text style={{ fontSize: 15, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Your board is empty
              </Text>
              <Text type="secondary" style={{ display: 'block' }}>
                Bring your own assets with <b style={{ color: '#165dff' }}>Add</b> (top-left) or just drag files in —
                or run the <b style={{ color: '#ff7d00' }}>Inspiration Board</b> on the right to generate references.
              </Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                Then <b>select</b> any asset and <b>drag a box</b> + release (or right-click) to run an agent on it.
              </Text>
            </div>
          </div>
        )}

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
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1]}
          panOnScroll
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onMoveStart={() => setCtxMenu((m) => (m ? null : m))}
          onPaneContextMenu={openContextMenu}
          onNodeContextMenu={(e) => openContextMenu(e)}
          onSelectionContextMenu={(e) => openContextMenu(e)}
          onPaneClick={() => setCtxMenu(null)}
        >
          <Background gap={20} />
          <Controls />
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

        {(storyStarted || activeLayerId === 'storyDirector') && (
          <StoryTimeline
            items={timelineItems}
            collapsed={timelineCollapsed}
            onToggle={() => setTimelineCollapsed((v) => !v)}
            onSelect={selectAndCenter}
            selectedId={selectedNodes[0]?.id}
            onAddAsset={addAssetToStory}
          />
        )}
      </div>

      {activeLayerId === 'storyDirector' ? (
        <StoryDirectorPanel
          started={storyStarted}
          stepCount={storyNodes.length}
          steps={storySteps}
          suggestions={storySuggestions}
          busy={storyBusy}
          canStartFromSelection={selectedNodes.some((n) => n.data?.kind === 'image' && n.data?.url)}
          apiKeyPresent={!!apiKey?.trim()}
          onStartFromSelection={startStoryFromSelection}
          onStartFromIdea={startStoryFromIdea}
          onReroll={() => requestSuggestions(storySteps, refUrl(storyNodes[storyNodes.length - 1]))}
          onPick={(beat) => generateStoryBeat(beat.prompt, beat.title)}
          onPickCustom={(text) => generateStoryBeat(text, text.slice(0, 48))}
          onEnd={() => setActiveLayerId(null)}
          onClose={() => setActiveLayerId(null)}
        />
      ) : activeLayerId === 'autoDirector' ? (
        <AutoDirectorPanel
          plan={autoPlan}
          apiKeyPresent={!!apiKey?.trim()}
          onCreate={startAutoDirector}
          onTakeOver={autoTakeOver}
          onClose={() => setActiveLayerId(null)}
        />
      ) : activeLayerId ? (
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
        />
      ) : null}
    </div>
    </AutoDirectorContext.Provider>
  );
};

const FilmCanvas = (props) => (
  <ReactFlowProvider>
    <FilmCanvasInner {...props} />
  </ReactFlowProvider>
);

export default FilmCanvas;
