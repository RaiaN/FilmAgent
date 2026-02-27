import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Message, Card, Typography, Collapse, Tooltip } from '@arco-design/web-react';
import { IconPlus, IconImage, IconVideoCamera, IconStar, IconLeft, IconRight, IconBulb, IconPalette, IconSwap, IconCamera, IconEdit, IconDoubleRight, IconFullscreen, IconPlayCircle, IconMinus, IconRobot, IconDownload, IconUpload } from '@arco-design/web-react/icon';
import ImageGenNode from './nodes/ImageGenNode';
import VideoGenNode from './nodes/VideoGenNode';
import PromptEnhancerNode from './nodes/PromptEnhancerNode';
import PresetNode from './nodes/PresetNode';
import VideoEditNode from './nodes/VideoEditNode';
import VideoExtendNode from './nodes/VideoExtendNode';
import MergeVideosNode from './nodes/MergeVideosNode';
import MultimodalVideoNode from './nodes/MultimodalVideoNode';
import AgenticNode from './nodes/AgenticNode';
import VLMNode from './nodes/VLMNode';
import ImageNode from './nodes/ImageNode';
import VideoNode from './nodes/VideoNode';
import { constructSeedreamPayload, constructSeedancePayload } from '../../utils/apiHelpers';
import { getApiKey } from '../../utils/apiKeyStore';

const nodeTypes = {
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  promptEnhancer: PromptEnhancerNode,
  preset: PresetNode,
  videoEdit: VideoEditNode,
  videoExtend: VideoExtendNode,
  mergeVideos: MergeVideosNode,
  multimodalVideo: MultimodalVideoNode,
  agentic: AgenticNode,
  llm: VLMNode, // Kept key as 'llm' to avoid breaking existing saves, but component is VLMNode
  image: ImageNode,
  video: VideoNode,
};

const initialNodes = [
  { 
    id: '1', 
    type: 'imageGen', 
    position: { x: 100, y: 100 }, 
    data: { 
        model: 'seedream-5-0-lite',
        prompt: 'A cinematic shot of a futuristic city',
        output: null,
        loading: false
    } 
  },
  { 
    id: '2', 
    type: 'videoGen', 
    position: { x: 500, y: 100 }, 
    data: { 
        model: 'seedance-1-5-pro-251215',
        prompt: 'Slow camera pan right, flying cars moving',
        resolution: '720p',
        duration: 5,
        generate_audio: true,
        inputImage: null,
        output: null,
        loading: false
    } 
  },
];

const initialEdges = [{ id: 'e1-2', source: '1', target: '2', animated: true }];

const WorkflowEditor = ({ active }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [isToolboxOpen, setIsToolboxOpen] = useState(true);
  const [activeKeys, setActiveKeys] = useState(['1', '2', '3']);
  const allCategoryKeys = ['1', '2', '3'];
  const toolboxHeaderRef = useRef(null);
  const toolboxScrollRef = useRef(null);
  const workflowImportInputRef = useRef(null);
  const [toolboxScrollbar, setToolboxScrollbar] = useState({ visible: false, trackTop: 0, thumbTop: 0, thumbHeight: 0 });

  const normalizeCollapseKeys = (key) => {
      if (Array.isArray(key)) return [...key];
      if (!key) return [];
      return [key];
  };

  const toggleCategory = (name) => {
      setActiveKeys((prev) => (prev.includes(name) ? prev.filter((k) => k !== name) : [...prev, name]));
  };

  const renderCategoryHeader = (name, label) => (
      <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
              e.stopPropagation();
              toggleCategory(name);
          }}
          style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              userSelect: 'none'
          }}
      >
          <span>{label}</span>
      </div>
  );

  const toggleAllCategories = () => {
      const nextKeys = activeKeys.length > 0 ? [] : allCategoryKeys;
      setActiveKeys(nextKeys);
  };

  const exportWorkflow = () => {
      const payload = {
          version: 1,
          nodes,
          edges
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
  };

  const importWorkflow = async (file) => {
      try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
              throw new Error('Invalid workflow file');
          }
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
          Message.success('Workflow imported');
      } catch (err) {
          Message.error(err?.message || 'Failed to import workflow');
      }
  };

  const updateToolboxScrollbar = useCallback(() => {
      const scrollEl = toolboxScrollRef.current;
      const headerEl = toolboxHeaderRef.current;

      if (!isToolboxOpen || !scrollEl || !headerEl) {
          setToolboxScrollbar((prev) => (prev.visible ? { visible: false, trackTop: 0, thumbTop: 0, thumbHeight: 0 } : prev));
          return;
      }

      const clientHeight = scrollEl.clientHeight;
      const scrollHeight = scrollEl.scrollHeight;
      const scrollTop = scrollEl.scrollTop;
      const trackTop = headerEl.offsetTop + headerEl.offsetHeight + 8;

      if (scrollHeight <= clientHeight + 1) {
          setToolboxScrollbar((prev) => (prev.visible ? { visible: false, trackTop, thumbTop: 0, thumbHeight: 0 } : prev));
          return;
      }

      const minThumbHeight = 28;
      const thumbHeight = Math.max(minThumbHeight, Math.round((clientHeight / scrollHeight) * clientHeight));
      const maxThumbTop = clientHeight - thumbHeight;
      const maxScrollTop = scrollHeight - clientHeight;
      const thumbTop = maxScrollTop > 0 ? Math.round((scrollTop / maxScrollTop) * maxThumbTop) : 0;

      setToolboxScrollbar({ visible: true, trackTop, thumbTop, thumbHeight });
  }, [isToolboxOpen]);

  useEffect(() => {
      updateToolboxScrollbar();
  }, [activeKeys, isToolboxOpen, updateToolboxScrollbar]);

  useEffect(() => {
      if (!active) return;
      if (!reactFlowInstance) return;

      const applyFit = () => {
          try {
              reactFlowInstance.fitView({ padding: 0.2, includeHiddenNodes: true });
          } catch {}
      };

      applyFit();
      requestAnimationFrame(applyFit);
      setTimeout(applyFit, 50);
  }, [active, reactFlowInstance]);

  useEffect(() => {
      const scrollEl = toolboxScrollRef.current;
      if (!scrollEl) return;

      const handleScroll = () => updateToolboxScrollbar();
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });

      const ro = new ResizeObserver(() => updateToolboxScrollbar());
      ro.observe(scrollEl);
      if (toolboxHeaderRef.current) ro.observe(toolboxHeaderRef.current);

      return () => {
          scrollEl.removeEventListener('scroll', handleScroll);
          ro.disconnect();
      };
  }, [updateToolboxScrollbar]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  // Helper to get connected upstream data
  // We need to know which handle was connected to update the correct input
  // ReactFlow onConnect params: { source, sourceHandle, target, targetHandle }
  const onConnectWithLogic = useCallback(
    (params) => {
        setEdges((eds) => addEdge({ ...params, animated: true }, eds));
        
        // Update target node data based on handle ID
        const targetNode = nodes.find(n => n.id === params.target);
        const sourceNode = nodes.find(n => n.id === params.source);
        
        if (targetNode && targetNode.type === 'videoGen') {
            // STRICT CONNECTION LOGIC FOR VIDEO GEN
            if (params.targetHandle === 'firstFrame' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputImage: sourceNode.data.output });
            } else if (params.targetHandle === 'lastFrame' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputLastFrame: sourceNode.data.output });
            } else if (params.targetHandle === 'prompt') {
                 // Allow Prompt Enhancer OR Presets
                 if (sourceNode.type === 'promptEnhancer' && sourceNode.data.outputPrompt) {
                     updateNodeData(targetNode.id, { inputPrompt: sourceNode.data.outputPrompt });
                 } else if (sourceNode.type === 'preset' && sourceNode.data.value) {
                     // Presets logic is handled via getUpstreamPrompts, but we can visual feedback here if needed
                     // Actually, getUpstreamPrompts needs to check connected edges to 'prompt' handle now
                 }
            }
        } else if (targetNode && targetNode.type === 'imageGen') {
             if (params.targetHandle === 'refImage' && sourceNode.data.output) {
                 // Append to refImages array if not already present
                 const currentRefs = targetNode.data.refImages || [];
                 if (!currentRefs.includes(sourceNode.data.output)) {
                     updateNodeData(targetNode.id, { refImages: [...currentRefs, sourceNode.data.output] });
                 }
             } else if (params.targetHandle === 'prompt') {
                 if (sourceNode.type === 'promptEnhancer' && sourceNode.data.outputPrompt) {
                     updateNodeData(targetNode.id, { inputPrompt: sourceNode.data.outputPrompt });
                 } else if (sourceNode.type === 'preset' && sourceNode.data.value) {
                     // Preset logic handled by getUpstreamPrompts
                 }
             }
        } else if (targetNode && targetNode.type === 'llm') {
             if (params.targetHandle === 'inputImage' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputImage: sourceNode.data.output });
             } else if (params.targetHandle === 'inputVideo' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputVideo: sourceNode.data.output });
             } else if (params.targetHandle === 'prompt') {
                 if (sourceNode.type === 'promptEnhancer' && sourceNode.data.outputPrompt) {
                     updateNodeData(targetNode.id, { inputPrompt: sourceNode.data.outputPrompt });
                 }
             }
        } else if (targetNode && targetNode.type === 'videoEdit') {
             if (params.targetHandle === 'inputVideo' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputVideo: sourceNode.data.output });
             }
        } else if (targetNode && targetNode.type === 'multimodalVideo') {
             if (params.targetHandle === 'inputImage' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputImage: sourceNode.data.output });
             } else if (params.targetHandle === 'inputVideo' && sourceNode.data.output) {
                 updateNodeData(targetNode.id, { inputVideo: sourceNode.data.output });
             }
        }
    },
    [nodes, setEdges],
  );

  const onEdgesDelete = useCallback((deletedEdges) => {
      deletedEdges.forEach((edge) => {
          const targetNode = nodes.find(n => n.id === edge.target);
          if (targetNode && targetNode.type === 'videoGen') {
              if (edge.targetHandle === 'lastFrame') {
                  updateNodeData(targetNode.id, { inputLastFrame: null });
              } else if (edge.targetHandle === 'firstFrame') {
                  updateNodeData(targetNode.id, { inputImage: null });
              } else if (edge.targetHandle === 'prompt') {
                  updateNodeData(targetNode.id, { inputPrompt: null });
              }
          } else if (targetNode && targetNode.type === 'imageGen') {
              if (edge.targetHandle === 'refImage') {
                  // Hard to remove specific ref image without tracking edge-to-image map. 
                  // For MVP, clear all ref images or just leave them (user can delete manually).
                  // Better: We can't easily know WHICH image came from this edge unless we track it.
                  // Let's reset refImages for safety or do nothing? 
                  // Let's do nothing for now, as user can click 'x' on the upload list.
                  // Actually, if we disconnect, we should probably clear the inputPrompt if it was the prompt handle.
              } else if (edge.targetHandle === 'prompt') {
                  updateNodeData(targetNode.id, { inputPrompt: null });
              }
          }
      });
  }, [nodes]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      // Extract preset type if any
      const [nodeType, subType] = type.split(':');

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      const newNode = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position,
        data: { 
            loading: false, 
            prompt: '', 
            // Defaults based on type
            ...(nodeType === 'imageGen' ? { model: 'seedream-5-0-lite', size: '2K' } : {}),
            ...(nodeType === 'videoGen' ? { model: 'seedance-1-5-pro-251215', resolution: '720p', duration: 5, generate_audio: true } : {}),
            ...(nodeType === 'promptEnhancer' ? { inputPrompt: '', outputPrompt: '' } : {}),
            ...(nodeType === 'videoEdit' ? { inputVideo: null, prompt: '' } : {}),
            ...(nodeType === 'videoExtend' ? { inputVideo: null } : {}),
            ...(nodeType === 'mergeVideos' ? { videoA: null, videoB: null } : {}),
            ...(nodeType === 'multimodalVideo' ? { inputImage: null, inputVideo: null, inputAudio: null, prompt: '' } : {}),
            ...(nodeType === 'agentic' ? { task: '', steps: [], dynamicOutputs: [] } : {}),
            ...(nodeType === 'llm' ? { inputImage: null, inputVideo: null, prompt: '', output: '' } : {}),
            ...(nodeType === 'image' ? { output: null } : {}),
            ...(nodeType === 'video' ? { output: null } : {}),
            ...(nodeType === 'preset' ? { presetType: subType, value: '' } : {})
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes],
  );

  // Helper to get connected upstream prompt texts
  const getUpstreamPrompts = (nodeId, allNodes, allEdges) => {
      // For VideoGen, only check edges connected to 'prompt' handle
      // For others, check any connection
      const incomingEdges = allEdges.filter(e => {
          if (e.target !== nodeId) return false;
          const targetNode = allNodes.find(n => n.id === nodeId);
          if (targetNode && targetNode.type === 'videoGen') {
              return e.targetHandle === 'prompt';
          }
          return true;
      });

      const promptParts = [];
      
      incomingEdges.forEach(edge => {
          const sourceNode = allNodes.find(n => n.id === edge.source);
          if (sourceNode) {
              if (sourceNode.type === 'preset' && sourceNode.data.value) {
                  promptParts.push(sourceNode.data.value);
              } else if (sourceNode.type === 'promptEnhancer' && sourceNode.data.outputPrompt) {
                  promptParts.push(sourceNode.data.outputPrompt);
              }
          }
      });
      return promptParts;
  };

  // Update node data helper
  const updateNodeData = (nodeId, newData) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data: { ...node.data, ...newData } };
          }
          return node;
        })
      );
  };

  // Run Image Generation
  const runImageGen = async (nodeId, data) => {
      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");

          // Collect upstream prompts
          const upstreamPrompts = getUpstreamPrompts(nodeId, nodes, edges);
          // Combine: Linked/Enhancer prompt OR Manual prompt, THEN append Presets
          // Prioritize Enhancer output if present in upstream, else use manual.
          // Wait, getUpstreamPrompts returns ALL parts. 
          // Strategy: If upstream has text, use that joined. If manual prompt exists, append it?
          // Better: Join all unique non-empty strings.
          
          let basePrompt = data.inputPrompt || data.prompt || "";
          // If inputPrompt came from enhancer via "push", it's already in data.inputPrompt.
          // But now we want to support "pulling" from multiple presets.
          // Let's rely on the "Pull" mainly.
          
          const combinedPrompt = [...new Set([basePrompt, ...upstreamPrompts])].filter(Boolean).join(', ');
          
          if (!combinedPrompt) throw new Error("Prompt is required");

          const payload = constructSeedreamPayload({
              model: data.model,
              prompt: combinedPrompt,
              size: data.size || '2K', 
              response_format: 'url',
              // Add reference image support if uploaded
              ...(data.refImages && data.refImages.length > 0 ? { image: data.refImages } : {})
          });

          const res = await fetch('/api/seedream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, apiKey })
          });
          const result = await res.json();
          
          // API might return 'image_url' (snake_case) or 'imageUrl' (camelCase) or 'images' array
          const outputUrl = result.image_url || result.imageUrl || (result.images && result.images[0] && result.images[0].url);

          if (outputUrl) {
              updateNodeData(nodeId, { output: outputUrl, loading: false });
              
              // Propagate to connected nodes
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  if (edge.targetHandle === 'lastFrame') {
                      updateNodeData(edge.target, { inputLastFrame: outputUrl });
                  } else {
                      updateNodeData(edge.target, { inputImage: outputUrl });
                  }
              });
              Message.success("Image Generated!");
          } else {
              // Only throw if there is no image_url
              console.error("API Error Result:", result); // Debugging log
              throw new Error(result.error || JSON.stringify(result) || "Generation failed");
          }
      } catch (err) {
          console.error("Image Gen Error:", err);
          Message.error(err.message || "Unknown error");
          updateNodeData(nodeId, { loading: false });
      }
  };

  // Run Video Generation
  const runVideoGen = async (nodeId, data) => {
      // Use linked image OR uploaded image
      const firstFrame = data.inputImage || data.uploadedImage;
      const lastFrame = data.inputLastFrame || data.lastFrame;

      if (!firstFrame) {
          Message.warning("No input image connected or uploaded!");
          return;
      }
      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");

          const upstreamPrompts = getUpstreamPrompts(nodeId, nodes, edges);
          let basePrompt = data.inputPrompt || data.prompt || "";
          const combinedPrompt = [...new Set([basePrompt, ...upstreamPrompts])].filter(Boolean).join(', ');

          const payload = constructSeedancePayload({
              model: data.model,
              prompt: combinedPrompt,
              first_frame: [firstFrame],
              resolution: data.resolution || '720p',
              duration: Number(data.duration) || 5,
              generate_audio: !!data.generate_audio,
              ...(lastFrame ? { last_frame: [lastFrame] } : {})
          });

          // Start Task
          const res = await fetch('/api/seedance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, apiKey })
          });
          const task = await res.json();
          
          if (task.id) {
              Message.info("Video task started, polling...");
              // Simple poll for MVP
              const poll = setInterval(async () => {
                  const statusRes = await fetch(`/api/seedance-status?taskId=${task.id}`, {
                      headers: { Authorization: `Bearer ${apiKey}` }
                  });
                  const statusData = await statusRes.json();
                  
                  if (statusData.status === 'succeeded') {
                      clearInterval(poll);
                      updateNodeData(nodeId, { output: statusData.video_url, loading: false });
                      Message.success("Video Generated!");
                  } else if (statusData.status === 'failed') {
                      clearInterval(poll);
                      updateNodeData(nodeId, { loading: false });
                      Message.error("Video Generation Failed");
                  }
              }, 3000);
          } else {
              throw new Error(task.error || "Task start failed");
          }
      } catch (err) {
          Message.error(err.message);
          updateNodeData(nodeId, { loading: false });
      }
  };

  // Run Prompt Enhancer
  const runPromptEnhancer = async (nodeId, data) => {
      if (!data.inputPrompt) {
          Message.warning("No input prompt!");
          return;
      }
      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");

          const res = await fetch('/api/seed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  prompt: data.inputPrompt,
                  apiKey: apiKey,
                  systemPrompt: "Enhance this prompt for image/video generation. Make it detailed, descriptive, and artistic. Return ONLY the prompt.",
                  modelId: 'seed-2-0-mini-260215'
              })
          });
          const result = await res.json();
          
          if (result.content) {
              updateNodeData(nodeId, { outputPrompt: result.content, loading: false });
              
              // Propagate to connected nodes (Image/Video Gen)
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  updateNodeData(edge.target, { inputPrompt: result.content });
              });
              Message.success("Prompt Enhanced!");
          } else {
              throw new Error("Enhancement failed");
          }
      } catch (err) {
          Message.error(err.message);
          updateNodeData(nodeId, { loading: false });
      }
  };

  // Run LLM Analysis
  const runLLM = async (nodeId, data) => {
      if (!data.inputPrompt && !data.prompt) {
          Message.warning("Please enter a prompt!");
          return;
      }
      
      const inputImage = data.inputImage || data.uploadedImage;
      const inputVideo = data.inputVideo || data.uploadedVideo;

      if (!inputImage && !inputVideo) {
          Message.warning("No input image or video!");
          // Actually LLM can run text-only, but the node is designed for analysis
      }

      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");

          // Build messages
          const payload = {
              prompt: data.inputPrompt || data.prompt,
              apiKey: apiKey,
              modelId: 'seed-2-0-mini-260215',
              image: inputImage, 
              video: inputVideo 
          };

          const res = await fetch('/api/seed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          const result = await res.json();
          
          if (result.content) {
              updateNodeData(nodeId, { output: result.content, loading: false });
              
              // Propagate to connected nodes (e.g. Prompt input of other nodes)
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  updateNodeData(edge.target, { inputPrompt: result.content });
              });
              Message.success("Analysis Complete!");
          } else {
              throw new Error("Analysis failed");
          }
      } catch (err) {
          Message.error(err.message);
          updateNodeData(nodeId, { loading: false });
      }
  };

  // Inject handlers into nodes
  const nodesWithHandlers = nodes.map(node => ({
      ...node,
      data: {
          ...node.data,
          onChange: (key, val) => updateNodeData(node.id, { [key]: val }),
          onReset: () => {
              if (node.type === 'imageGen') {
                  updateNodeData(node.id, { output: null, loading: false, refImages: [] });
              } else if (node.type === 'videoGen') {
                  updateNodeData(node.id, { output: null, loading: false, uploadedImage: null, lastFrame: null, inputImage: null });
              } else if (node.type === 'promptEnhancer') {
                  updateNodeData(node.id, { outputPrompt: '', loading: false });
              } else if (node.type === 'llm') {
                  updateNodeData(node.id, { output: '', loading: false, uploadedImage: null, uploadedVideo: null });
              }
          },
          onRun: () => {
              if (node.type === 'imageGen') runImageGen(node.id, node.data);
              if (node.type === 'videoGen') runVideoGen(node.id, node.data);
              if (node.type === 'promptEnhancer') runPromptEnhancer(node.id, node.data);
              if (node.type === 'llm') runLLM(node.id, node.data);
              if (node.type === 'agentic') runAgentic(node.id, node.data);
          }
      }
  }));

  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', position: 'relative', minHeight: 0 }}>
        {/* Toolbox Sidebar */}
        <div
          className="workflow-toolbox"
          style={{ 
            width: isToolboxOpen ? 210 : 44, 
            height: '100%',
            minHeight: 0,
            padding: isToolboxOpen ? 10 : 6, 
            background: '#fff', 
            borderRight: '1px solid #e5e6eb', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 8,
            transition: 'width 0.3s ease, padding 0.3s ease',
            position: 'relative',
            overflow: 'hidden'
        }}
        >
            <div ref={toolboxHeaderRef} style={{ display: 'flex', justifyContent: isToolboxOpen ? 'space-between' : 'center', alignItems: 'center', minHeight: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button 
                        shape="circle" 
                        type="secondary"
                        size="mini"
                        icon={isToolboxOpen ? <IconLeft /> : <IconRight />} 
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsToolboxOpen(!isToolboxOpen);
                        }}
                    />
                    {isToolboxOpen && (
                        <Typography.Title heading={6} style={{ margin: 0, fontSize: 14 }}>Toolbox</Typography.Title>
                    )}
                </div>
                {isToolboxOpen && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tooltip content="Export workflow">
                            <Button
                              icon={<IconDownload />}
                              size="mini"
                              type="text"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                  e.stopPropagation();
                                  exportWorkflow();
                              }}
                              style={{ padding: '0 4px' }}
                            />
                        </Tooltip>
                        <Tooltip content="Import workflow">
                            <Button
                              icon={<IconUpload />}
                              size="mini"
                              type="text"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                  e.stopPropagation();
                                  workflowImportInputRef.current?.click();
                              }}
                              style={{ padding: '0 4px' }}
                            />
                        </Tooltip>
                        <Tooltip content={activeKeys.length === 0 ? "Expand All" : "Collapse All"}>
                            <Button 
                                icon={activeKeys.length === 0 ? <IconPlus /> : <IconMinus />} 
                                size="mini" 
                                type="text"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleAllCategories();
                                }}
                                style={{ padding: '0 4px' }}
                            />
                        </Tooltip>
                    </div>
                )}
            </div>
            {isToolboxOpen && (
                <input
                  ref={workflowImportInputRef}
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) importWorkflow(file);
                      e.target.value = '';
                  }}
                />
            )}
            {isToolboxOpen && (
            <div ref={toolboxScrollRef} className="workflow-toolbox-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingRight: 10 }}>
                <Collapse 
                    activeKey={activeKeys} 
                    onChange={(key) => setActiveKeys(normalizeCollapseKeys(key))}
                    style={{ border: 'none' }}
                    accordion={false}
                >
                    <Collapse.Item header={renderCategoryHeader('1', 'Generative AI')} name="1" contentStyle={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'image')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconImage style={{ color: '#165dff' }} /> Image
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'video')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconVideoCamera style={{ color: '#722ed1' }} /> Video
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'imageGen')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconImage style={{ color: '#165dff' }} /> Image Gen
                            </div>
                            
                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'videoGen')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconVideoCamera style={{ color: '#ff7d00' }} /> Video Gen
                            </div>
                            
                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'promptEnhancer')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconStar style={{ color: '#ffb400' }} /> Enhancer
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'llm')}
                                style={{ padding: '8px 12px', border: '1px solid #c9cdd4', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f8f9fa' }}
                            >
                                <IconRobot style={{ color: '#165dff' }} /> AI Analysis
                            </div>
                        </div>
                    </Collapse.Item>

                    <Collapse.Item header={renderCategoryHeader('3', 'Seedance (2.0)')} name="3" contentStyle={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Tooltip content="Coming Soon in Seedance 2.0">
                                <div 
                                    style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f2f3f5', color: '#86909c', cursor: 'not-allowed' }}
                                >
                                    <IconEdit style={{ color: '#86909c' }} /> Video Edit
                                </div>
                            </Tooltip>

                            <Tooltip content="Coming Soon in Seedance 2.0">
                                <div 
                                    style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f2f3f5', color: '#86909c', cursor: 'not-allowed' }}
                                >
                                    <IconDoubleRight style={{ color: '#86909c' }} /> Video Extend
                                </div>
                            </Tooltip>

                            <Tooltip content="Coming Soon in Seedance 2.0">
                                <div 
                                    style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f2f3f5', color: '#86909c', cursor: 'not-allowed' }}
                                >
                                    <IconFullscreen style={{ color: '#86909c' }} /> Merge Videos
                                </div>
                            </Tooltip>

                            <Tooltip content="Coming Soon in Seedance 2.0">
                                <div 
                                    style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 12, background: '#f2f3f5', color: '#86909c', cursor: 'not-allowed' }}
                                >
                                    <IconPlayCircle style={{ color: '#86909c' }} /> Multimodal Video
                                </div>
                            </Tooltip>
                        </div>
                    </Collapse.Item>

                    <Collapse.Item header={renderCategoryHeader('2', 'Presets')} name="2" contentStyle={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'preset:camera')}
                                style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 11, background: '#fff' }}
                            >
                                <IconCamera style={{ color: '#165dff' }} /> Camera
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'preset:lighting')}
                                style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 11, background: '#fff' }}
                            >
                                <IconBulb style={{ color: '#ff7d00' }} /> Lighting
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'preset:style')}
                                style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 11, background: '#fff' }}
                            >
                                <IconPalette style={{ color: '#722ed1' }} /> Style
                            </div>

                            <div 
                                draggable 
                                onDragStart={(event) => onDragStart(event, 'preset:movement')}
                                style={{ padding: '8px 12px', border: '1px solid #e5e6eb', borderRadius: 6, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 11, background: '#fff' }}
                            >
                                <IconSwap style={{ color: '#00b42a' }} /> Movement
                            </div>
                        </div>
                    </Collapse.Item>
                </Collapse>
            </div>
            )}

            {isToolboxOpen && toolboxScrollbar.visible && (
                <div
                  aria-hidden
                  style={{
                      position: 'absolute',
                      right: 3,
                      top: toolboxScrollbar.trackTop,
                      bottom: 12,
                      width: 6,
                      borderRadius: 999,
                      background: 'rgba(0,0,0,0.04)'
                  }}
                >
                    <div
                      style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: toolboxScrollbar.thumbTop,
                          height: toolboxScrollbar.thumbHeight,
                          borderRadius: 999,
                          background: 'rgba(0,0,0,0.35)'
                      }}
                    />
                </div>
            )}
        </div>

        {/* Main Canvas */}
        <div style={{ flex: 1, height: '100%', background: '#f6f7f9' }} ref={reactFlowWrapper}>
            <ReactFlow
                nodes={nodesWithHandlers}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnectWithLogic}
                onEdgesDelete={onEdgesDelete}
                onInit={setReactFlowInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    </div>
  );
};

const WorkflowEditorWithProvider = ({ active }) => (
  <ReactFlowProvider>
    <WorkflowEditor active={active} />
  </ReactFlowProvider>
);

export default WorkflowEditorWithProvider;
