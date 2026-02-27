import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VLMNode from '../../../../components/workflow/nodes/VLMNode';

// Mock @xyflow/react Handle component
jest.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

describe('VLMNode', () => {
  const mockData = {
    inputPrompt: null,
    prompt: 'Analyze this image',
    inputImage: null,
    inputVideo: null,
    uploadedImage: null,
    uploadedVideo: null,
    output: null,
    loading: false,
    onChange: jest.fn(),
    onRun: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default data', () => {
    render(<VLMNode data={mockData} />);
    
    expect(screen.getByText('VLM (AI Analysis)')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    
    const promptInput = screen.getByPlaceholderText('Ask something...');
    expect(promptInput).toHaveValue('Analyze this image');
  });

  it('calls onChange when prompt input changes', () => {
    render(<VLMNode data={mockData} />);
    
    const promptInput = screen.getByPlaceholderText('Ask something...');
    fireEvent.change(promptInput, { target: { value: 'New prompt' } });
    
    expect(mockData.onChange).toHaveBeenCalledWith('prompt', 'New prompt');
  });

  it('calls onRun when Run Analysis button is clicked', () => {
    render(<VLMNode data={mockData} />);
    
    const runButton = screen.getByText('Run Analysis');
    fireEvent.click(runButton);
    
    expect(mockData.onRun).toHaveBeenCalled();
  });

  it('displays loading state correctly', () => {
    render(<VLMNode data={{ ...mockData, loading: true }} />);
    
    const runButton = screen.getByText('Run Analysis').closest('button');
    expect(runButton).toBeInTheDocument();
  });

  it('displays output analysis text when present', () => {
    const analysisText = 'This is an image of a cat.';
    render(<VLMNode data={{ ...mockData, output: analysisText }} />);
    
    expect(screen.getByText(analysisText)).toBeInTheDocument();
  });

  it('shows linked image indicator when inputImage is provided', () => {
    const imageUrl = 'http://example.com/cat.png';
    render(<VLMNode data={{ ...mockData, inputImage: imageUrl }} />);
    
    expect(screen.getByText('Linked')).toBeInTheDocument();
  });
});
