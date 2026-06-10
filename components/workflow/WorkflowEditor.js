import { useEffect, useState, useCallback, useRef } from 'react';
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Message, Typography, Collapse, Tooltip } from '@arco-design/web-react';
import { IconPlus, IconImage, IconVideoCamera, IconStar, IconLeft, IconRight, IconEdit, IconDoubleRight, IconFullscreen, IconPlayCircle, IconMinus, IconRobot, IconImport, IconExport } from '@arco-design/web-react/icon';
import ImageGenNode from './nodes/ImageGenNode';
import VideoGenNode from './nodes/VideoGenNode';
import PromptEnhancerNode from './nodes/PromptEnhancerNode';
import VideoEditNode from './nodes/VideoEditNode';
import VideoExtendNode from './nodes/VideoExtendNode';
import MergeVideosNode from './nodes/MergeVideosNode';
import MultimodalVideoNode from './nodes/MultimodalVideoNode';
import AgenticNode from './nodes/AgenticNode';
import VLMNode from './nodes/VLMNode';
import ImageNode from './nodes/ImageNode';
import VideoNode from './nodes/VideoNode';
import { constructWorkflowSeedreamPayload, constructSeedancePayload } from '../../utils/apiHelpers';
import { getApiKey } from '../../utils/apiKeyStore';
import { getNodeDefaults, getNodeInputs } from './nodeDefinitions';

const nodeTypes = {
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  promptEnhancer: PromptEnhancerNode,
  vlm: VLMNode,
  videoEdit: VideoEditNode,
  videoExtend: VideoExtendNode,
  mergeVideos: MergeVideosNode,
  multimodalVideo: MultimodalVideoNode,
  agentic: AgenticNode,
  image: ImageNode,
  video: VideoNode,
};

const initialNodes = [
  { 
    id: '1', 
    type: 'imageGen', 
    position: { x: 100, y: 100 }, 
    data: { 
        ...getNodeDefaults('imageGen'),
        prompt: 'A cinematic shot of a futuristic city'
    } 
  },
  { 
    id: '2', 
    type: 'videoGen', 
    position: { x: 500, y: 100 }, 
    data: { 
        ...getNodeDefaults('videoGen'),
        prompt: 'Cinematic drone shot flying over a futuristic city with neon lights and flying cars at night, highly detailed, photorealistic, 4k, slow smooth motion',
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
  const [activeKeys, setActiveKeys] = useState(['1', '3']);
  const allCategoryKeys = ['1', '3'];
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

  // Import/Export Logic
  const exportWorkflow = () => {
      const flow = reactFlowInstance.toObject();
      const edges = flow.edges;
      
      // Identify nodes with connected prompts
      // If a node has a connection to its 'prompt' handle, the data.prompt value is derived (ephemeral).
      // If NOT connected, data.prompt is user manual input (configuration).
      const nodesWithConnectedPrompt = new Set();
      edges.forEach(edge => {
          if (edge.targetHandle === 'prompt') {
              nodesWithConnectedPrompt.add(edge.target);
          }
      });
      
      // Filter out sensitive/large data from nodes
      const cleanNodes = flow.nodes.map(node => {
          const cleanData = { ...node.data };
          
          const isPromptConnected = nodesWithConnectedPrompt.has(node.id);
          
          const ephemeralKeys = [
              'output', 
              'loading',
              'uploadedImage', 'uploadedVideo', // Large blobs
              'referenceImages', // VideoGen inputs
              'inputImage', 'inputVideo', 'inputAudio', // VLM/Multimodal inputs
              'refImages', // ImageGen inputs
              'videoA', 'videoB', // Merge inputs
              ...(isPromptConnected ? ['prompt'] : []) // Only delete prompt if it's a connected value
          ];

          ephemeralKeys.forEach(key => delete cleanData[key]);
          
          return {
              ...node,
              data: cleanData
          };
      });

      const exportData = {
          ...flow,
          nodes: cleanNodes
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "workflow.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const importWorkflow = (file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const flow = JSON.parse(event.target.result);
              if (flow && flow.nodes && flow.edges) {
                  // Restore handlers
                  const restoredNodes = flow.nodes.map(node => ({
                      ...node,
                      data: {
                          ...node.data,
                          // Ensure defaults are present
                          ...getNodeDefaults(node.type),
                          // Override with saved data
                          ...node.data
                      }
                  }));
                  setNodes(restoredNodes);
                  setEdges(flow.edges);
                  
                  // Wait for render then fit view
                  setTimeout(() => {
                      reactFlowInstance.fitView();
                  }, 100);
                  Message.success("Workflow imported successfully");
              } else {
                  throw new Error("Invalid workflow file format");
              }
          } catch (err) {
              console.error(err);
              Message.error("Failed to import workflow");
          }
      };
      reader.readAsText(file);
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

  // Helper to get connected upstream data
  // We need to know which handle was connected to update the correct input
  // ReactFlow onConnect params: { source, sourceHandle, target, targetHandle }
  const onConnectWithLogic = useCallback(
    (params) => {
        setEdges((eds) => addEdge({ ...params, animated: true }, eds));
        
        const targetNode = nodes.find(n => n.id === params.target);
        const sourceNode = nodes.find(n => n.id === params.source);
        
        if (!targetNode || !sourceNode) return;

        // Check compatibility via Schema
        const inputs = getNodeInputs(targetNode.type);
        if (!inputs) return; 
        
        const inputConfig = inputs[params.targetHandle];
        if (!inputConfig) return; // Invalid handle

        const sourceHandleId = params.sourceHandle || 'output'; 
        const sourceDataValue = sourceNode.data[sourceHandleId];
        
        if (!sourceDataValue) return; // No data to pass

        // Data Mapping Logic
        let dataKey = params.targetHandle;
        
        // Generic mapping for 'prompt' handle -> 'prompt' data key
        if (params.targetHandle === 'prompt') {
            dataKey = 'prompt'; // Standardized to 'prompt'
        }

        // Handle deviations (legacy/special mappings)
        if (targetNode.type === 'imageGen' && params.targetHandle === 'refImage') {
             // Special case: refImage -> refImages array
             const currentRefs = targetNode.data.refImages || [];
             if (!currentRefs.includes(sourceDataValue)) {
                 updateNodeData(targetNode.id, { refImages: [...currentRefs, sourceDataValue] });
             }
             return;
        }

        if (targetNode.type === 'videoGen' && params.targetHandle === 'referenceImage') {
            const currentRefs = targetNode.data.referenceImages || [];
            if (!currentRefs.includes(sourceDataValue)) {
                updateNodeData(targetNode.id, { referenceImages: [...currentRefs, sourceDataValue] });
            }
            return;
        }

        // Generic Update
        updateNodeData(targetNode.id, { [dataKey]: sourceDataValue });
    },
    [nodes, setEdges],
  );

  const onEdgesDelete = useCallback((deletedEdges) => {
      deletedEdges.forEach((edge) => {
          const targetNode = nodes.find(n => n.id === edge.target);
          if (!targetNode) return;

          // Data-driven reset based on nodeDefinitions
          const inputs = getNodeInputs(targetNode.type);
          const handleId = edge.targetHandle;
          
          if (inputs && inputs[handleId]) {
              const inputConfig = inputs[handleId];
              
              let dataKey = handleId;
              let resetValue = null;

              // Override for specific known deviations
              // Most nodes follow dataKey = handleId (default)
              if (targetNode.type === 'imageGen' && handleId === 'refImage') {
                  dataKey = 'refImages';
                  resetValue = [];
              } else if (targetNode.type === 'videoGen' && handleId === 'referenceImage') {
                  dataKey = 'referenceImages';
                  resetValue = [];
              } else if (targetNode.type === 'promptEnhancer' && handleId === 'prompt') {
                  resetValue = ''; // Explicitly empty string for text input
              }

              // Check if schema defines it as multiple
              if (inputConfig.multiple && resetValue === null) {
                  resetValue = [];
              }

              updateNodeData(targetNode.id, { [dataKey]: resetValue });
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

      const nodeType = type;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      const newNode = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position,
        data: { 
            // Load defaults from centralized schema
            ...getNodeDefaults(nodeType)
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes],
  );


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

          // Priority: 1. Connected Prompt (upstream) overwrites manual prompt if both map to 'prompt'
          // Actually, 'data.prompt' IS the unified field now.
          const combinedPrompt = data.prompt;
          
          if (!combinedPrompt) throw new Error("Prompt is required");

          const payload = constructWorkflowSeedreamPayload({
              model: data.model,
              prompt: combinedPrompt,
              size: data.size || '2K', 
              // Use ONLY pushed refImages
              ...(data.refImages && data.refImages.length > 0 ? { image: data.refImages } : {})
          });

          const res = await fetch('/api/seedream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, apiKey })
          });
          const result = await res.json();
          
          // Follow the Seedream tab response contract from /api/seedream.
          const outputUrl = result.imageUrl || (result.images && result.images[0] && result.images[0].url);

          if (outputUrl) {
              updateNodeData(nodeId, { output: outputUrl, loading: false });
              
              // Propagate to connected nodes
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  const targetNode = nodes.find(n => n.id === edge.target);
                  if (targetNode) {
                      if (targetNode.type === 'imageGen' && edge.targetHandle === 'refImage') {
                          const currentRefs = targetNode.data.refImages || [];
                          if (!currentRefs.includes(outputUrl)) {
                              updateNodeData(targetNode.id, { refImages: [...currentRefs, outputUrl] });
                          }
                      } else if (targetNode.type === 'videoGen' && edge.targetHandle === 'referenceImage') {
                          const currentRefs = targetNode.data.referenceImages || [];
                          if (!currentRefs.includes(outputUrl)) {
                              updateNodeData(targetNode.id, { referenceImages: [...currentRefs, outputUrl] });
                          }
                      } else if (targetNode.type === 'vlm') {
                          updateNodeData(targetNode.id, { inputImage: outputUrl });
                      } else if (targetNode.type === 'multimodalVideo') {
                          updateNodeData(targetNode.id, { inputImage: outputUrl });
                      }
                  }
              });
              Message.success("Image Generated!");
          } else {
              console.error("API Error Result:", result); // Debugging log
              const detailMessage =
                  result?.details?.error?.message ||
                  result?.details?.message ||
                  (typeof result?.details === 'string' ? result.details : '') ||
                  result.error;
              throw new Error(detailMessage || "Seedream generation failed");
          }
      } catch (err) {
          console.error("Image Gen Error:", err);
          Message.error(err.message || "Unknown error");
          updateNodeData(nodeId, { loading: false });
      }
  };

  // Run Video Generation
  const runVideoGen = async (nodeId, data) => {
      const referenceImages = data.referenceImages || [];

      if (referenceImages.length === 0) {
          Message.warning("No reference image connected!");
          return;
      }
      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");

          // Priority: 1. Connected Prompt (upstream) overwrites manual prompt if both map to 'prompt'
          // Actually, 'data.prompt' IS the unified field now.
          const combinedPrompt = data.prompt;
          
          if (!combinedPrompt) throw new Error("Prompt is required");

          const payload = constructSeedancePayload({
              model: data.model,
              prompt: combinedPrompt,
              reference_images: referenceImages,
              resolution: data.resolution || '720p',
              duration: data.duration ?? 'auto',
              generate_audio: !!data.generate_audio,
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
                      const outputUrl = statusData.video_url;
                      updateNodeData(nodeId, { output: outputUrl, loading: false });

                      // Propagate to connected nodes
                      const connectedEdges = edges.filter(e => e.source === nodeId);
                      connectedEdges.forEach(edge => {
                          const targetNode = nodes.find(n => n.id === edge.target);
                          if (targetNode) {
                              if (targetNode.type === 'vlm') {
                                  updateNodeData(targetNode.id, { inputVideo: outputUrl });
                              } else if (targetNode.type === 'multimodalVideo') {
                                  updateNodeData(targetNode.id, { inputVideo: outputUrl });
                              } else if (targetNode.type === 'videoEdit') {
                                  updateNodeData(targetNode.id, { inputVideo: outputUrl });
                              } else if (targetNode.type === 'videoExtend') {
                                  updateNodeData(targetNode.id, { inputVideo: outputUrl });
                              }
                          }
                      });
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
      if (!data.prompt) {
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
                  prompt: data.prompt,
                  apiKey: apiKey,
                  systemPrompt: "Enhance this prompt for image/video generation. Make it detailed, descriptive, and artistic. Return ONLY the prompt.",
                  modelId: 'seed-2-0-mini-260215'
              })
          });
          const result = await res.json();
          
          if (result.content) {
              updateNodeData(nodeId, { output: result.content, loading: false });
              
              // Propagate to connected nodes (Image/Video Gen)
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  updateNodeData(edge.target, { prompt: result.content });
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

  // Run LLM / VLM Node
  const runVLM = async (nodeId, data) => {
      // Use ONLY pushed inputs
      const image = data.inputImage;
      const video = data.inputVideo;

      if (!image && !video) {
          Message.warning("No image or video input connected!");
          return;
      }

      updateNodeData(nodeId, { loading: true });
      try {
          const apiKey = getApiKey();
          if (!apiKey) throw new Error("API Key missing");
          
          const payload = {
              modelId: data.model || 'seed-2-0-pro-260328', // Fallback to seed pro
              prompt: data.prompt || "Convert into prompt",
              apiKey: apiKey,
              image, 
              video
          };

          const res = await fetch('/api/seed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          
          if (!res.ok) {
              const errorText = await res.text();
              let errorMsg = `API Error ${res.status}`;
              try {
                  const errorJson = JSON.parse(errorText);
                  if (errorJson.error) {
                      // Check for specific Seed error structure
                      if (typeof errorJson.error === 'string') {
                          errorMsg = errorJson.error;
                      } else if (errorJson.error.details && errorJson.error.details.error && errorJson.error.details.error.message) {
                           errorMsg = errorJson.error.details.error.message;
                      } else if (errorJson.details && errorJson.details.error && errorJson.details.error.message) {
                           errorMsg = errorJson.details.error.message;
                      }
                  }
              } catch (e) {
                  // If text is not JSON, use raw text
                  errorMsg = errorText;
              }
              
              if (res.status === 429) {
                  errorMsg = "Rate limit exceeded (429). Please wait a moment before retrying.";
              }
              
              throw new Error(errorMsg);
          }

          const result = await res.json();
          
          if (result.content) {
              updateNodeData(nodeId, { output: result.content, loading: false });
              
              // Propagate to connected nodes (e.g. Prompt input of other nodes)
              const connectedEdges = edges.filter(e => e.source === nodeId);
              connectedEdges.forEach(edge => {
                  updateNodeData(edge.target, { prompt: result.content });
              });
              Message.success("Analysis Complete!");
          } else {
              throw new Error(result.error || "Analysis failed");
          }
      } catch (err) {
          console.error("VLM Error:", err);
          
          // Display a friendly notification
          const msg = err.message || "Unknown error occurred";
          Notification.error({
              title: 'Analysis Failed',
              content: msg,
              duration: 5000,
          });
          
          // Also show in the node output for context
          updateNodeData(nodeId, { output: `[Error] ${msg}`, loading: false });
      }
  };

  // Inject handlers into nodes
  const nodesWithHandlers = nodes.map(node => ({
      ...node,
      data: {
          ...node.data,
          onChange: (key, val) => updateNodeData(node.id, { [key]: val }),
          onRun: () => {
              if (node.type === 'imageGen') runImageGen(node.id, node.data);
              else if (node.type === 'videoGen') runVideoGen(node.id, node.data);
              else if (node.type === 'promptEnhancer') runPromptEnhancer(node.id, node.data);
              else if (node.type === 'vlm') runVLM(node.id, node.data);
              // else if (node.type === 'agentic') runAgentic(node.id, node.data);
          },
          onReset: () => {
              const defaults = getNodeDefaults(node.type);
              updateNodeData(node.id, { ...defaults });
              // Preserve persistent fields if needed (like prompt if we only want to clear output)
              // But onReset usually means "reset state", maybe not "clear user input"
              // The original code reset specific fields. Let's stick to partial reset for UX.
              // Actually, looking at original code, it reset 'output', 'loading', 'inputImage' etc.
              // So we should probably define "reset state" separately or just manually reset execution state.
              if (node.type === 'imageGen') updateNodeData(node.id, { output: null, loading: false });
              else if (node.type === 'videoGen') updateNodeData(node.id, { output: null, loading: false });
              else if (node.type === 'promptEnhancer') updateNodeData(node.id, { output: '', loading: false });
              else if (node.type === 'vlm') updateNodeData(node.id, { output: '', loading: false });
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
                        <Tooltip content="Import workflow">
                            <Button
                              icon={<IconImport />}
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
                        <Tooltip content="Export workflow">
                            <Button
                              icon={<IconExport />}
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
                                onDragStart={(event) => onDragStart(event, 'vlm')}
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
