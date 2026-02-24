import React from 'react';
import { Modal, Button } from '@arco-design/web-react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Minimal node components for the inspector
const SimpleNode = ({ data, label, color = '#165dff' }) => (
    <div style={{ 
        padding: '8px 16px', 
        borderRadius: 4, 
        border: `1px solid ${color}`, 
        background: '#fff',
        minWidth: 120,
        textAlign: 'center',
        fontSize: 12,
        fontWeight: 500
    }}>
        {label || data.label}
    </div>
);

const nodeTypes = {
    default: SimpleNode,
    input: SimpleNode,
    output: SimpleNode
};

const PipelineInspector = ({ visible, onCancel, subgraph }) => {
    return (
        <Modal
            title="Agentic Execution Plan"
            visible={visible}
            onCancel={onCancel}
            footer={
                <Button type="primary" onClick={onCancel}>
                    Close
                </Button>
            }
            style={{ width: 800, height: 600 }}
        >
            <div style={{ width: '100%', height: 500, background: '#f6f7f9', border: '1px solid #e5e6eb', borderRadius: 4 }}>
                <ReactFlow
                    nodes={subgraph?.nodes || []}
                    edges={subgraph?.edges || []}
                    nodeTypes={nodeTypes}
                    fitView
                    attributionPosition="bottom-right"
                >
                    <Background color="#ccc" gap={16} />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
        </Modal>
    );
};

export default PipelineInspector;