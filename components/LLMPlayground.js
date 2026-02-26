import React, { useState } from 'react';
import { Select, Input, Button, Upload, Message, Grid, Card, Typography, Tooltip } from '@arco-design/web-react';
import { IconImage, IconVideoCamera, IconSend, IconRobot, IconRefresh } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Title, Text } = Typography;

const LLMPlayground = ({ schema, formValues, setFormValues, onSubmit, loading, handleImageUpload, removeImage, onModelChange, result, capabilities, onRefreshModels }) => {
    
    // Default to true if capabilities not loaded yet to avoid flickering, or handle gracefully
    const supportsImage = capabilities?.supportsImage ?? true;
    const supportsVideo = capabilities?.supportsVideo ?? true;

    const handleInputChange = (key, value) => {
        setFormValues(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 140px)', paddingBottom: 20 }}>
            <div style={{ width: 400, display: 'flex', flexDirection: 'column' }}>
             <Card style={{ marginBottom: 20, flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 16 }}>
                    <div style={{ marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Model</span>
                        {onRefreshModels && (
                            <Tooltip content="Refresh Model List">
                                <Button 
                                    icon={<IconRefresh />} 
                                    size="mini" 
                                    type="text" 
                                    onClick={onRefreshModels}
                                />
                            </Tooltip>
                        )}
                    </div>
                    <Select 
                        style={{ width: '100%' }}
                        value={formValues.model}
                        onChange={(val) => {
                            handleInputChange('model', val);
                            // If parent needs event, we mock it or pass val directly if parent supports it.
                            // The parent `onModelChange` expects an event-like object or we update formValues directly here.
                            // Actually setFormValues is passed, so we updated it above.
                        }}
                        options={schema?.fields?.find(f => f.key === 'model')?.options || []}
                    />
                </div>

                <div style={{ marginBottom: 16 }}>
                     <div style={{ marginBottom: 8, fontWeight: 500 }}>Media (Image/Video)</div>
                     <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {/* Images */}
                        {supportsImage && (formValues.image || []).map((img, idx) => (
                             <div key={`img-${idx}`} style={{ position: 'relative', width: 100, height: 100, border: '1px solid #ccc', borderRadius: 4, overflow: 'hidden' }}>
                                <img src={img} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <Button 
                                    size='mini' 
                                    status='danger' 
                                    style={{ position: 'absolute', top: 0, right: 0 }}
                                    onClick={() => removeImage('image', idx)}
                                >x</Button>
                             </div>
                        ))}
                         {/* Videos */}
                        {supportsVideo && (formValues.video || []).map((vid, idx) => (
                             <div key={`vid-${idx}`} style={{ position: 'relative', width: 100, height: 100, border: '1px solid #ccc', borderRadius: 4, overflow: 'hidden', background: '#000' }}>
                                <video src={vid} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                <Button 
                                    size='mini' 
                                    status='danger' 
                                    style={{ position: 'absolute', top: 0, right: 0 }}
                                    onClick={() => removeImage('video', idx)}
                                >x</Button>
                             </div>
                        ))}

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
                            <div style={{ width: 100, height: 100, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexDirection: 'column' }}>
                                <IconImage style={{ fontSize: 20, marginBottom: 4 }} />
                                <span style={{ fontSize: 12 }}>Add Image</span>
                            </div>
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
                            <div style={{ width: 100, height: 100, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexDirection: 'column' }}>
                                <IconVideoCamera style={{ fontSize: 20, marginBottom: 4 }} />
                                <span style={{ fontSize: 12 }}>Add Video</span>
                            </div>
                        </Upload>
                        )}
                     </div>
                </div>

                <div style={{ marginBottom: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>Prompt</div>
                    <Input.TextArea
                        style={{ flex: 1, minHeight: 150, resize: 'none' }}
                        value={formValues.prompt}
                        onChange={(val) => handleInputChange('prompt', val)}
                        placeholder="Ask something about the image or video..."
                    />
                </div>
                
                <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #eee' }}>
                    <Button type="primary" long onClick={onSubmit} loading={loading} icon={<IconSend />}>
                        Run Analysis
                    </Button>
                </div>
             </Card>
        </div>

        <div style={{ flex: 1 }}>
             <Card 
                title="Analysis Result" 
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                bodyStyle={{ flex: 1, overflowY: 'auto' }}
            >
                 {loading ? (
                     <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Analyzing...</div>
                 ) : result && result.content ? (
                     <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word', userSelect: 'text', cursor: 'text' }}>
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                                p: ({node, ...props}) => <p style={{ marginBottom: 12 }} {...props} />,
                                ul: ({node, ...props}) => <ul style={{ paddingLeft: 20, marginBottom: 12 }} {...props} />,
                                ol: ({node, ...props}) => <ol style={{ paddingLeft: 20, marginBottom: 12 }} {...props} />,
                                pre: ({node, ...props}) => <div style={{ marginBottom: 12 }} {...props} />, 
                                code: ({node, inline, ...props}) => (
                                    inline 
                                    ? <code style={{ background: '#f2f3f5', padding: '2px 4px', borderRadius: 4, wordBreak: 'break-word' }} {...props} />
                                    : <code style={{ display: 'block', background: '#f8f9fa', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} {...props} />
                                )
                            }}
                        >
                            {result.content}
                        </ReactMarkdown>
                     </div>
                 ) : result && result.error ? (
                     <div style={{ color: 'red' }}>
                         <strong>Error:</strong> {result.error}
                         {result.details && <pre>{JSON.stringify(result.details, null, 2)}</pre>}
                     </div>
                 ) : (
                     <div style={{ textAlign: 'center', padding: 40, color: '#ccc' }}>
                        Result will appear here
                     </div>
                 )}
             </Card>
        </div>
    </div>
  );
};

export default LLMPlayground;
