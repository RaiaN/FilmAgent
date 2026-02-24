import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Tooltip, Tag, Input, Button, Steps, Popover, Message } from '@arco-design/web-react';
import { IconRobot, IconEye, IconCheckCircle, IconLoading, IconPlayCircle, IconTool } from '@arco-design/web-react/icon';
import PipelineInspector from '../PipelineInspector';

const Step = Steps.Step;

const AgenticNode = ({ data }) => {
  const [task, setTask] = useState(data.task || '');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [planBuilt, setPlanBuilt] = useState(!!data.subgraph);
  const [steps, setSteps] = useState(data.steps || []);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [subgraph, setSubgraph] = useState(data.subgraph || null);

  const handleBuildPlan = () => {
      if (!task) {
          Message.warning("Please enter a task first");
          return;
      }
      setIsPlanning(true);
      // Mock planning delay
      setTimeout(() => {
          setIsPlanning(false);
          setPlanBuilt(true);
          
          // Mock intelligent step generation based on keywords
          let newSteps = [];
          let outputs = [];
          let mockNodes = [];
          let mockEdges = [];

          if (task.toLowerCase().includes('edit') || task.toLowerCase().includes('highlight')) {
              newSteps = [
                  { title: 'Analyze Video Content', status: 'wait' },
                  { title: 'Identify Key Moments', status: 'wait' },
                  { title: 'Split into Clips', status: 'wait' },
                  { title: 'Export Highlights', status: 'wait' }
              ];
              outputs = ['Clip 1', 'Clip 2', 'Clip 3'];
              
              // Mock Subgraph
              mockNodes = [
                  { id: 'sub-1', position: { x: 0, y: 100 }, data: { label: 'Input Video' }, type: 'input' },
                  { id: 'sub-2', position: { x: 200, y: 100 }, data: { label: 'Scene Analysis' }, type: 'default' },
                  { id: 'sub-3', position: { x: 400, y: 100 }, data: { label: 'Highlight Detector' }, type: 'default' },
                  { id: 'sub-4', position: { x: 600, y: 0 }, data: { label: 'Clip 1' }, type: 'output' },
                  { id: 'sub-5', position: { x: 600, y: 100 }, data: { label: 'Clip 2' }, type: 'output' },
                  { id: 'sub-6', position: { x: 600, y: 200 }, data: { label: 'Clip 3' }, type: 'output' },
              ];
              mockEdges = [
                  { id: 'e1-2', source: 'sub-1', target: 'sub-2' },
                  { id: 'e2-3', source: 'sub-2', target: 'sub-3' },
                  { id: 'e3-4', source: 'sub-3', target: 'sub-4' },
                  { id: 'e3-5', source: 'sub-3', target: 'sub-5' },
                  { id: 'e3-6', source: 'sub-3', target: 'sub-6' },
              ];

          } else if (task.toLowerCase().includes('similar')) {
              newSteps = [
                  { title: 'Extract Style & Motion', status: 'wait' },
                  { title: 'Generate Variation 1', status: 'wait' },
                  { title: 'Generate Variation 2', status: 'wait' }
              ];
              outputs = ['Variation 1', 'Variation 2'];
              
              mockNodes = [
                  { id: 'sub-1', position: { x: 0, y: 100 }, data: { label: 'Input Video' }, type: 'input' },
                  { id: 'sub-2', position: { x: 200, y: 100 }, data: { label: 'Style Extractor' }, type: 'default' },
                  { id: 'sub-3', position: { x: 400, y: 50 }, data: { label: 'Video Gen (Var 1)' }, type: 'default' },
                  { id: 'sub-4', position: { x: 400, y: 150 }, data: { label: 'Video Gen (Var 2)' }, type: 'default' },
                  { id: 'sub-5', position: { x: 600, y: 50 }, data: { label: 'Output 1' }, type: 'output' },
                  { id: 'sub-6', position: { x: 600, y: 150 }, data: { label: 'Output 2' }, type: 'output' },
              ];
              mockEdges = [
                  { id: 'e1-2', source: 'sub-1', target: 'sub-2' },
                  { id: 'e2-3', source: 'sub-2', target: 'sub-3' },
                  { id: 'e2-4', source: 'sub-2', target: 'sub-4' },
                  { id: 'e3-5', source: 'sub-3', target: 'sub-5' },
                  { id: 'e4-6', source: 'sub-4', target: 'sub-6' },
              ];
          } else {
              newSteps = [
                  { title: 'Understand Intent', status: 'wait' },
                  { title: 'Execute Task', status: 'wait' }
              ];
              outputs = ['Result'];
              mockNodes = [
                  { id: 'sub-1', position: { x: 0, y: 0 }, data: { label: 'Task Input' }, type: 'input' },
                  { id: 'sub-2', position: { x: 200, y: 0 }, data: { label: 'General Processor' }, type: 'default' },
                  { id: 'sub-3', position: { x: 400, y: 0 }, data: { label: 'Result' }, type: 'output' },
              ];
              mockEdges = [
                  { id: 'e1-2', source: 'sub-1', target: 'sub-2' },
                  { id: 'e2-3', source: 'sub-2', target: 'sub-3' },
              ];
          }

          const mockSubgraph = { nodes: mockNodes, edges: mockEdges };
          
          setSteps(newSteps);
          setSubgraph(mockSubgraph);
          data.onChange('steps', newSteps);
          data.onChange('subgraph', mockSubgraph);
          data.onChange('dynamicOutputs', outputs);
          Message.success("Plan built! You can now inspect or execute.");
      }, 1500);
  };

  const handleExecute = () => {
      setIsExecuting(true);
      // Mock execution
      let currentStep = 0;
      const interval = setInterval(() => {
          if (currentStep >= steps.length) {
              clearInterval(interval);
              setIsExecuting(false);
              Message.success("Agentic Task Completed!");
              return;
          }
          
          setSteps(prev => prev.map((s, i) => {
              if (i < currentStep) return { ...s, status: 'finish' };
              if (i === currentStep) return { ...s, status: 'process' };
              return { ...s, status: 'wait' };
          }));
          currentStep++;
      }, 1000);
  };

  return (
    <Card 
        style={{ width: 320, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 4px 10px rgba(0,0,0,0.1)', position: 'relative', background: '#f0f5ff' }}
        bodyStyle={{ padding: 12 }}
    >
      <PipelineInspector 
        visible={inspectorVisible} 
        onCancel={() => setInspectorVisible(false)} 
        subgraph={subgraph}
      />

      {/* Dynamic Input Handles */}
      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Tooltip content="Context (Video/Image/Text)">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="context" style={{ background: '#722ed1', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid #d9e1ff', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconRobot style={{ marginRight: 8, color: '#165dff', fontSize: 18 }} />
              <Typography.Text bold>Agentic Director</Typography.Text>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
              {planBuilt && (
                  <Tooltip content="Inspect Pipeline">
                      <Button 
                        icon={<IconEye />} 
                        size="mini" 
                        shape="circle" 
                        type="secondary" 
                        onClick={() => setInspectorVisible(true)}
                      />
                  </Tooltip>
              )}
              <Tag color="arcoblue" size="small">AI</Tag>
          </div>
      </div>

      <div style={{ marginBottom: 12 }}>
          <Input.TextArea 
            placeholder="What should I do? (e.g. 'Create 3 highlight clips from this video')" 
            style={{ minHeight: 70, fontSize: 12, background: '#fff' }}
            value={task}
            onChange={setTask}
            onBlur={() => data.onChange('task', task)}
            disabled={isExecuting}
          />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button 
            type="secondary" 
            size="small" 
            icon={<IconTool />}
            onClick={handleBuildPlan} 
            loading={isPlanning}
            disabled={isExecuting}
          >
              Build Plan
          </Button>
          <Button 
            type="primary" 
            size="small" 
            icon={<IconPlayCircle />}
            onClick={handleExecute} 
            loading={isExecuting}
            disabled={!planBuilt || isPlanning}
            style={{ background: '#165dff' }}
          >
              Execute
          </Button>
      </div>

      {/* Dynamic Output Handles */}
      {data.dynamicOutputs && data.dynamicOutputs.length > 0 && (
          <div style={{ position: 'absolute', right: -8, top: 40, display: 'flex', flexDirection: 'column', gap: 30 }}>
              {data.dynamicOutputs.map((outputName, index) => (
                  <Tooltip key={index} content={outputName}>
                      <div style={{ position: 'relative', width: 16, height: 16 }}>
                          <Handle 
                            type="source" 
                            position={Position.Right} 
                            id={`output-${index}`} 
                            style={{ background: '#00b42a', width: 16, height: 16, border: '2px solid #fff' }} 
                          />
                          <div style={{ position: 'absolute', right: 20, top: -2, whiteSpace: 'nowrap', fontSize: 10, color: '#86909c' }}>{outputName}</div>
                      </div>
                  </Tooltip>
              ))}
          </div>
      )}
    </Card>
  );
};

export default memo(AgenticNode);