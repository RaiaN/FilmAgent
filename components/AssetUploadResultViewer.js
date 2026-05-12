import { Card, Descriptions, Space, Tag, Typography } from '@arco-design/web-react';
import CopyButton from './CopyButton';

const statusColor = (status) => {
  switch (status) {
    case 'Active':
      return 'green';
    case 'Failed':
      return 'red';
    case 'Pending':
    case 'Processing':
      return 'arcoblue';
    default:
      return 'orange';
  }
};

const AssetUploadResultViewer = ({ result }) => {
  if (!result) return null;

  if (result.error) {
    return <div className="result">{JSON.stringify(result, null, 2)}</div>;
  }

  const asset = result.asset || {};

  return (
    <div style={{ marginTop: '2rem' }}>
      <Card title="Asset Upload Result">
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Space wrap>
            <Tag color={statusColor(asset.Status)}>{asset.Status || 'UNKNOWN'}</Tag>
            <Tag color="green">AssetType: Image</Tag>
          </Space>

          <Descriptions
            column={1}
            data={[
              { label: 'Group ID', value: result.groupId || '-' },
              { label: 'Asset ID', value: asset.Id || result.assetId || '-' },
              { label: 'Asset URL', value: asset.URL || result.imageUrl || '-' },
              { label: 'Asset Name', value: asset.Name || result.assetName || '-' },
              { label: 'Create Time', value: asset.CreateTime || '-' },
              { label: 'Update Time', value: asset.UpdateTime || '-' },
            ]}
          />

          {asset.URL && (
            <div>
              <Typography.Text bold>Preview</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <img
                  src={asset.URL}
                  alt={asset.Name || 'Uploaded asset'}
                  style={{ maxWidth: 320, borderRadius: 8, border: '1px solid #e5e6eb' }}
                />
              </div>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text bold>Raw Response</Typography.Text>
              <CopyButton text={JSON.stringify(result, null, 2)} />
            </div>
            <Typography.Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                marginTop: 8,
                marginBottom: 0,
                padding: 12,
                background: '#f7f8fa',
                borderRadius: 8,
              }}
            >
              {JSON.stringify(result, null, 2)}
            </Typography.Paragraph>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default AssetUploadResultViewer;
