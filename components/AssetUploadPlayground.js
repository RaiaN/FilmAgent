import { Button, Card, Checkbox, Input, Space, Tag, Typography, Upload } from '@arco-design/web-react';
import { IconBook, IconDelete, IconImage, IconUpload } from '@arco-design/web-react/icon';
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

  const clearLocalImage = () => {
    setFormValues((prev) => ({
      ...prev,
      localImageData: '',
      localImageName: '',
    }));
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
            <Tag color="purple">Create image asset</Tag>
            <Tag color="orange">Poll GetAsset</Tag>
            <Tag color="gold">Images only</Tag>
          </Space>
        </Card>

        <Card title="Asset Group" style={{ marginBottom: 16 }}>
          <FieldBlock
            label="Asset Group ID"
            value={formValues.assetGroupId || ''}
            placeholder="Format: group-{timestamp}-{random}"
            onChange={(value) => handleInputChange('assetGroupId', value)}
          />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            The field starts with a generated valid id like `group-1712345678901-ab12cd34`. The server can also fall back to `MODELARK_ASSET_GROUP_ID` from `.env.local`.
          </Typography.Paragraph>
        </Card>

        <Card title="Image Asset" style={{ marginBottom: 16 }}>
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
                  <Button size="small" icon={<IconDelete />} onClick={clearLocalImage}>
                    Remove
                  </Button>
                  <Button
                    size="small"
                    type="secondary"
                    onClick={onStageToTos}
                    loading={stagingLoading}
                  >
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
          <FieldBlock
            label="Asset Name"
            value={formValues.assetName || ''}
            placeholder="Optional human-readable name"
            onChange={(value) => handleInputChange('assetName', value)}
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
        </Card>

        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 16 }}>
          If you choose a local image, you can upload it to TOS first with the button above. The backend can also stage it
          automatically during `CreateAsset` using server-side `.env.local` settings.
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
            <span>AssetType: Image</span>
          </div>
          <div className={styles.toolChip}>
            <span>URL upload only</span>
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
            {loading ? 'Uploading Asset...' : 'Create Image Asset'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AssetUploadPlayground;
