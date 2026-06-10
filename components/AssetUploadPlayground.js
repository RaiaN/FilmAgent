import { Button, Card, Checkbox, Collapse, Input, Message, Radio, Space, Tag, Typography, Upload } from '@arco-design/web-react';
import { IconBook, IconDelete, IconImage, IconUpload, IconVideoCamera } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';

const FieldBlock = ({ label, value, placeholder, onChange }) => {
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text bold>{label}</Typography.Text>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        style={{ marginTop: 8 }}
      />
    </div>
  );
};

const AssetUploadPlayground = ({
  formValues,
  setFormValues,
  onSubmit,
  loading,
  onStageToTos,
  stagingLoading,
}) => {
  const handleInputChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const assetType = formValues.assetType || 'Image';
  const isVideo = assetType === 'Video';

  const handleLocalImageUpload = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        setFormValues((prev) => ({
          ...prev,
          localImageData: reader.result,
          localImageName: file.name,
          imageUrl: prev.imageUrl || '',
        }));
        resolve(false);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleLocalVideoUpload = (file) => {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        URL.revokeObjectURL(objectUrl);
        if (videoEl.duration > 15) {
          Message.error(`Video is ${Math.round(videoEl.duration)}s — maximum allowed is 15 seconds.`);
          resolve(false);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          setFormValues((prev) => ({
            ...prev,
            localVideoData: reader.result,
            localVideoName: file.name,
            videoUrl: prev.videoUrl || '',
          }));
          resolve(false);
        };
        reader.onerror = () => resolve(false);
        reader.readAsDataURL(file);
      };
      videoEl.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        Message.error('Could not read video file.');
        resolve(false);
      };
      videoEl.src = objectUrl;
    });
  };

  const clearLocalImage = () => {
    setFormValues((prev) => ({ ...prev, localImageData: '', localImageName: '' }));
  };

  const clearLocalVideo = () => {
    setFormValues((prev) => ({ ...prev, localVideoData: '', localVideoName: '' }));
  };

  return (
    <div className={styles.playgroundContainer}>
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <IconUpload style={{ fontSize: '1.2rem', marginRight: '0.5rem' }} />
          <Typography.Text bold>Private Asset Library</Typography.Text>
          <Button
            icon={<IconBook />}
            shape="circle"
            type="text"
            onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/2333565', '_blank')}
            style={{ marginLeft: 8 }}
          />
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <Card title="Upload Flow" style={{ marginBottom: 16 }}>
          <Space wrap size="medium">
            <Tag color="arcoblue">AK/SK auth</Tag>
            <Tag color="green">Use fixed asset group</Tag>
            <Tag color="purple">Create {isVideo ? 'video' : 'image'} asset</Tag>
            <Tag color="orange">Poll GetAsset</Tag>
          </Space>
        </Card>

        <Collapse style={{ marginBottom: 16 }} bordered={false}>
          <Collapse.Item
            header={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Asset Group ID: <span style={{ fontFamily: 'monospace' }}>{formValues.assetGroupId || '(not set)'}</span>
              </Typography.Text>
            }
            name="assetGroup"
          >
            <FieldBlock
              label="Asset Group ID"
              value={formValues.assetGroupId || ''}
              placeholder="Format: group-{timestamp}-{random}"
              onChange={(value) => handleInputChange('assetGroupId', value)}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Falls back to <code>MODELARK_ASSET_GROUP_ID</code> in <code>.env.local</code> if left as-is.
            </Typography.Text>
          </Collapse.Item>
        </Collapse>

        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Asset</span>
              <Radio.Group
                value={assetType}
                onChange={(val) => handleInputChange('assetType', val)}
                type="button"
                size="small"
              >
                <Radio value="Image">Image</Radio>
                <Radio value="Video">Video (≤15s)</Radio>
              </Radio.Group>
            </div>
          }
          style={{ marginBottom: 16 }}
        >
          {/* Image mode */}
          {!isVideo && (
            <>
              <Typography.Text bold>Local Image</Typography.Text>
              <div style={{ marginTop: 8, marginBottom: 16 }}>
                {!formValues.localImageData ? (
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleLocalImageUpload(file);
                      return false;
                    }}
                  >
                    <Button icon={<IconImage />}>Choose Local Image</Button>
                  </Upload>
                ) : (
                  <div>
                    <img
                      src={formValues.localImageData}
                      alt={formValues.localImageName || 'Local asset'}
                      style={{ maxWidth: 280, borderRadius: 8, border: '1px solid #e5e6eb' }}
                    />
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Typography.Text>{formValues.localImageName || 'Selected image'}</Typography.Text>
                      <Button size="small" icon={<IconDelete />} onClick={clearLocalImage}>Remove</Button>
                      <Button size="small" type="secondary" onClick={onStageToTos} loading={stagingLoading}>
                        {stagingLoading ? 'Uploading To TOS...' : 'Upload To TOS'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <FieldBlock
                label="Image URL"
                value={formValues.imageUrl || ''}
                placeholder="Optional when using a local image. Example: https://example.com/portrait.png"
                onChange={(value) => handleInputChange('imageUrl', value)}
              />

              {formValues.imageUrl && !formValues.localImageData && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">Preview</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <img
                      src={formValues.imageUrl}
                      alt="Asset preview"
                      style={{ maxWidth: 280, borderRadius: 8, border: '1px solid #e5e6eb' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Video mode */}
          {isVideo && (
            <>
              <Typography.Text bold>Local Video</Typography.Text>
              <div style={{ marginTop: 8, marginBottom: 16 }}>
                {!formValues.localVideoData ? (
                  <Upload
                    accept="video/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleLocalVideoUpload(file);
                      return false;
                    }}
                  >
                    <Button icon={<IconVideoCamera />}>Choose Local Video</Button>
                  </Upload>
                ) : (
                  <div>
                    <video
                      src={formValues.localVideoData}
                      controls
                      style={{ maxWidth: 280, borderRadius: 8, border: '1px solid #e5e6eb', display: 'block' }}
                    />
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Typography.Text>{formValues.localVideoName || 'Selected video'}</Typography.Text>
                      <Button size="small" icon={<IconDelete />} onClick={clearLocalVideo}>Remove</Button>
                      <Button size="small" type="secondary" onClick={onStageToTos} loading={stagingLoading}>
                        {stagingLoading ? 'Uploading To TOS...' : 'Upload To TOS'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <FieldBlock
                label="Video URL"
                value={formValues.videoUrl || ''}
                placeholder="Optional when using a local video. Example: https://example.com/clip.mp4"
                onChange={(value) => handleInputChange('videoUrl', value)}
              />

              {formValues.videoUrl && !formValues.localVideoData && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">Preview</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <video
                      src={formValues.videoUrl}
                      controls
                      style={{ maxWidth: 280, borderRadius: 8, border: '1px solid #e5e6eb', display: 'block' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <FieldBlock
            label="Asset Name"
            value={formValues.assetName || ''}
            placeholder="Optional human-readable name"
            onChange={(value) => handleInputChange('assetName', value)}
          />
        </Card>

        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 16 }}>
          {isVideo
            ? 'If you choose a local video, you can upload it to TOS first with the button above. Maximum video duration is 15 seconds.'
            : 'If you choose a local image, you can upload it to TOS first with the button above. The backend can also stage it automatically during CreateAsset using server-side .env.local settings.'}
        </Typography.Paragraph>

        <div style={{ marginTop: 16 }}>
          <Checkbox
            checked={formValues.pollUntilReady !== false}
            onChange={(checked) => handleInputChange('pollUntilReady', checked)}
          >
            Poll until the asset becomes Active or Failed
          </Checkbox>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolChip}>
            <span>Region: ap-southeast-1</span>
          </div>
          <div className={styles.toolChip}>
            <span>Action: CreateAsset</span>
          </div>
          <div className={styles.toolChip}>
            <span>AssetType: {assetType}</span>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            className={styles.submitBtn}
            shape="round"
            size="large"
            style={{ marginLeft: 'auto' }}
          >
            {loading ? 'Uploading Asset...' : `Create ${assetType} Asset`}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AssetUploadPlayground;
