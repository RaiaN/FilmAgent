import React, { useState } from 'react';

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? '✓ Copied' : '📋'}
    </button>
  );
};

export default CopyButton;
