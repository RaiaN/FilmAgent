import React, { useState } from 'react';
import { Select, Input, Button, Upload, Message, Grid, Card, Typography } from '@arco-design/web-react';
import { IconImage, IconVideoCamera, IconSend, IconRobot } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Title, Text } = Typography;

const LLMPlayground = ({
  formValues,
  setFormValues,
  onSubmit,
  loading,
  schema,
  handleImageUpload,
  removeImage,
  onModelChange,
  result
}) => {

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const modelOptions = schema?.fields?.find(f => f.key === 'model')?.options || [];

  return (
    <div className={styles.playgroundContainer}>
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}><IconRobot /></span>
          <Select
            value={formValues.model}
            onChange={(val) => onModelChange({ target: { value: val } })}
            style={{ width: 280 }}
          >
            {modelOptions.map(opt => (
              <Select.Option key={opt} value={opt}>{opt}</Select.Option>
            ))}
          </Select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 200px)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <Card title="Input" style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ marginBottom: 16 }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>Media (Image/Video)</div>
                     <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {/* Images */}
                        {(formValues.image || []).map((img, idx) => (
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
                        {(formValues.video || []).map((vid, idx) => (
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
                
                <Button type="primary" long onClick={onSubmit} loading={loading} icon={<IconSend />}>
                    Analyze
                </Button>
             </Card>
        </div>

        <div style={{ flex: 1 }}>
             <Card title="Analysis Result" style={{ height: '100%', overflowY: 'auto' }}>
                 {loading ? (
                     <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Analyzing...</div>
                 ) : result && result.content ? (
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {result.content}
                     </ReactMarkdown>
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
    </div>
  );
};

export default LLMPlayground;
