import React, { useState, useEffect } from 'react';
import { Select, Input, Button, Upload, Message, Grid, Card, Typography, Tooltip, Empty, Spin } from '@arco-design/web-react';
import { IconImage, IconVideoCamera, IconSend, IconRobot, IconRefresh, IconBook, IconDelete, IconPlus } from '@arco-design/web-react/icon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Title, Text } = Typography;

const LLMPlayground = ({ 
    schema, 
    formValues, 
    setFormValues, 
    onSubmit, 
    loading, 
    handleImageUpload, 
    removeImage, 
    onModelChange, 
    result, 
    capabilities, 
    onRefreshModels 
}) => {
    
    // Capabilities defaults
    const supportsImage = capabilities?.supportsImage ?? true;
    const supportsVideo = capabilities?.supportsVideo ?? true;

    const handleInputChange = (key, value) => {
        setFormValues(prev => ({ ...prev, [key]: value }));
    };

    // Extract options safely
    const modelOptions = schema?.fields?.find(f => f.key === 'model' || f.name === 'model')?.options || [];

    return (
        <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 140px)', paddingBottom: 20 }}>
            {/* Left Panel: Controls & Input */}
            <div style={{ width: 400, display: 'flex', flexDirection: 'column' }}>
             <Card 
                style={{ marginBottom: 20, flex: 1, display: 'flex', flexDirection: 'column' }} 
                bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20 }}
             >
                {/* Model Selection */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Model</span>
                        <div style={{ display: 'flex' }}>
                            {onRefreshModels && (
                                <Tooltip content="Refresh Model List">
                                    <Button 
                                        icon={<IconRefresh />} 
                                        size="mini" 
                                        type="text" 
                                        onClick={onRefreshModels}
                                        style={{ marginRight: 8 }}
                                    />
                                </Tooltip>
                            )}
                            <Tooltip content="API Reference">
                                <Button 
                                    icon={<IconBook />} 
                                    size="mini" 
                                    type="text" 
                                    onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/1902647', '_blank')}
                                />
                            </Tooltip>
                        </div>
                    </div>
                    <Select 
                        style={{ width: '100%' }}
                        value={formValues.model}
                        placeholder="Select a model"
                        onChange={(val) => {
                            handleInputChange('model', val);
                            if (onModelChange) {
                                onModelChange({ target: { value: val } });
                            }
                        }}
                        options={modelOptions}
                    />
                </div>

                {/* Media Upload Section */}
                <div style={{ marginBottom: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
                     <div style={{ marginBottom: 8, fontWeight: 500 }}>Media Context</div>
                     
                     <div style={{ 
                         flex: 1, 
                         background: '#f8f9fa', 
                         borderRadius: 8, 
                         border: '1px solid #e5e6eb',
                         padding: 12,
                         overflowY: 'auto',
                         minHeight: 120
                     }}>
                        {/* Render Uploaded Images */}
                        {supportsImage && (formValues.image || []).map((img, idx) => (
                             <div key={`img-${idx}`} style={{ position: 'relative', marginBottom: 12, border: '1px solid #e5e6eb', borderRadius: 6, overflow: 'hidden' }}>
                                <img src={img} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', display: 'block' }} />
                                <div style={{ position: 'absolute', top: 4, right: 4 }}>
                                    <Button 
                                        size='mini' 
                                        status='danger' 
                                        shape='circle'
                                        icon={<IconDelete />}
                                        onClick={() => removeImage('image', idx)}
                                    />
                                </div>
                                <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                                    Image {idx + 1}
                                </div>
                             </div>
                        ))}

                        {/* Render Uploaded Videos */}
                        {supportsVideo && (formValues.video || []).map((vid, idx) => (
                             <div key={`vid-${idx}`} style={{ position: 'relative', marginBottom: 12, border: '1px solid #e5e6eb', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                                <video src={vid} style={{ width: '100%', maxHeight: 200, display: 'block' }} controls />
                                <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 10 }}>
                                    <Button 
                                        size='mini' 
                                        status='danger' 
                                        shape='circle'
                                        icon={<IconDelete />}
                                        onClick={() => removeImage('video', idx)}
                                    />
                                </div>
                                <div style={{ position: 'absolute', bottom: 30, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                                    Video {idx + 1}
                                </div>
                             </div>
                        ))}

                        {/* Upload Buttons */}
                        <div style={{ display: 'flex', gap: 12, marginTop: (formValues.image?.length || formValues.video?.length) ? 8 : 0 }}>
                            {supportsImage && (
                                <Upload
                                    showUploadList={false}
                                    accept="image/*"
                                    beforeUpload={(file) => {
                                        const mockEvent = { target: { files: [file] } };
                                        handleImageUpload(mockEvent, 'image');
                                        return false;
                                    }}
                                >
                                    <Button icon={<IconImage />} size="small">Add Image</Button>
                                </Upload>
                            )}
                            {supportsVideo && (
                                <Upload
                                    showUploadList={false}
                                    accept="video/*"
                                    beforeUpload={(file) => {
                                        const mockEvent = { target: { files: [file] } };
                                        handleImageUpload(mockEvent, 'video');
                                        return false;
                                    }}
                                >
                                    <Button icon={<IconVideoCamera />} size="small">Add Video</Button>
                                </Upload>
                            )}
                        </div>
                     </div>
                </div>

                {/* Prompt Input */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>Prompt</div>
                    <Input.TextArea
                        style={{ height: 100, resize: 'none' }}
                        value={formValues.prompt}
                        onChange={(val) => handleInputChange('prompt', val)}
                        placeholder="Ask something about the uploaded media..."
                    />
                </div>
                
                <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #eee' }}>
                    <Button type="primary" long onClick={onSubmit} loading={loading} icon={<IconSend />}>
                        Run Analysis
                    </Button>
                </div>
             </Card>
        </div>

        {/* Right Panel: Analysis Result */}
        <div style={{ flex: 1 }}>
             <Card 
                title="Analysis Result" 
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                bodyStyle={{ flex: 1, overflowY: 'auto', padding: 24 }}
            >
                 {loading ? (
                     <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#86909c' }}>
                         <Spin dot />
                         <div style={{ marginTop: 16 }}>Analyzing content...</div>
                     </div>
                 ) : result && result.content ? (
                     <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                                p: ({node, ...props}) => <p style={{ marginBottom: 12, lineHeight: 1.6 }} {...props} />,
                                ul: ({node, ...props}) => <ul style={{ paddingLeft: 20, marginBottom: 12 }} {...props} />,
                                ol: ({node, ...props}) => <ol style={{ paddingLeft: 20, marginBottom: 12 }} {...props} />,
                                pre: ({node, ...props}) => <div style={{ marginBottom: 12 }} {...props} />, 
                                code: ({node, inline, ...props}) => (
                                    inline 
                                    ? <code style={{ background: '#f2f3f5', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }} {...props} />
                                    : <code style={{ display: 'block', background: '#f8f9fa', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} {...props} />
                                )
                            }}
                        >
                            {result.content}
                        </ReactMarkdown>
                     </div>
                 ) : result && result.error ? (
                     <div style={{ color: 'red', padding: 20, background: '#fff7f7', borderRadius: 8, border: '1px solid #ffecec' }}>
                         <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Error</div>
                         {typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}
                         {result.details && <pre style={{ marginTop: 8, fontSize: 12, background: 'rgba(255,0,0,0.05)', padding: 8 }}>{typeof result.details === 'string' ? result.details : JSON.stringify(result.details, null, 2)}</pre>}
                     </div>
                 ) : (
                     <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#c9cdd4' }}>
                        <IconRobot style={{ fontSize: 48, marginBottom: 16 }} />
                        <div>Analysis result will appear here</div>
                     </div>
                 )}
             </Card>
        </div>
    </div>
  );
};

export default LLMPlayground;
