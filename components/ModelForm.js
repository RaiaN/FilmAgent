import React from 'react';

const ModelForm = ({ uiSchema, formValues, setFormValues, onSubmit, loading, handleImageUpload, removeImage, activeModelId, onModelChange }) => {
  return (
    <form onSubmit={onSubmit}>
      <div className="field-grid">
        {uiSchema.fields.filter((field) => !field.hidden).map((field) => {
          const value = formValues[field.key] ?? '';

          if (field.type === 'enum') {
            return (
              <div className="field" key={field.key}>
                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                <select
                  id={`field-${field.key}`}
                  value={value}
                  disabled={field.readOnly}
                  onChange={(event) => {
                    if (field.key === 'model' && onModelChange) {
                        onModelChange(event);
                    } else {
                        setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }));
                    }
                  }}
                >
                  {field.options.map((option) => {
                    const label = typeof option === 'object' ? option.label : option;
                    const val = typeof option === 'object' ? option.value : option;
                    return (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          }
          if (field.type === 'image-list') {
            return (
              <div className="field full-width" key={field.key}>
                <label>{field.label}</label>
                <div className="image-drop-area">
                  <div className="image-preview-row">
                    {(value || []).map((img, idx) => (
                      <div key={idx} className="image-preview-item">
                        <img src={img} alt={`ref-${idx}`} />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => removeImage(field.key, idx)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="file-input-wrapper">
                    <span>Click to upload images (or drag here)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleImageUpload(e, field.key)}
                    />
                  </div>
                </div>
                <p className="helper">{field.description}</p>
              </div>
            );
          }
          if (field.type === 'video-list') {
            return (
              <div className="field full-width" key={field.key}>
                <label>{field.label}</label>
                <div className="image-drop-area">
                  <div className="image-preview-row">
                    {(value || []).map((vid, idx) => (
                      <div key={idx} className="image-preview-item" style={{ width: '200px' }}>
                        <video src={vid} controls style={{ width: '100%', maxHeight: '150px' }} />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => removeImage(field.key, idx)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="file-input-wrapper">
                    <span>Click to upload videos (or drag here)</span>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={(e) => handleImageUpload(e, field.key)}
                    />
                  </div>
                </div>
                <p className="helper">{field.description}</p>
              </div>
            );
          }
          if (field.type === 'number') {
            return (
              <div className="field" key={field.key}>
                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                <input
                  id={`field-${field.key}`}
                  type="number"
                  value={value}
                  disabled={field.readOnly}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      [field.key]: Number(event.target.value),
                    }))
                  }
                />
                <p className="helper">{field.description}</p>
              </div>
            );
          }
          if (field.type === 'boolean') {
            return (
              <div className="field" key={field.key}>
                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                <input
                  id={`field-${field.key}`}
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={field.readOnly}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, [field.key]: event.target.checked }))
                  }
                />
              </div>
            );
          }
          if (field.key === 'prompt') {
            return (
              <div className="field full-width" key={field.key}>
                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                <textarea
                  id={`field-${field.key}`}
                  value={value}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              </div>
            );
          }
          return (
            <div className="field" key={field.key}>
              <label htmlFor={`field-${field.key}`}>{field.label}</label>
              <input
                id={`field-${field.key}`}
                value={value}
                disabled={field.readOnly}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
              />
            </div>
          );
        })}
      </div>

      <div className="actions" style={{ marginTop: '2rem' }}>
        <button type="submit" disabled={loading} className="primary-btn-lg">
          {loading ? 'Generating...' : 'Generate Media'}
        </button>
      </div>
    </form>
  );
};

export default ModelForm;
