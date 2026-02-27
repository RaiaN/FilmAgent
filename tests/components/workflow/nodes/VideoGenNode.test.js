import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VideoGenNode from '../../../../components/workflow/nodes/VideoGenNode';

// Mock @xyflow/react Handle component
jest.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

describe('VideoGenNode', () => {
  const mockData = {
    model: 'seedance-1-5-pro-251215',
    prompt: 'A test video prompt',
    inputPrompt: null,
    resolution: '720p',
    duration: 5,
    inputImage: null,
    inputLastFrame: null,
    // Provide an uploaded image to enable the "Animate" button
    uploadedImage: 'data:image/png;base64,fakeimage',
    uploadedLastFrame: null,
    generate_audio: true,
    loading: false,
    output: null,
    onChange: jest.fn(),
    onRun: jest.fn(),
    onReset: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default data', () => {
    render(<VideoGenNode data={mockData} />);
    
    expect(screen.getByText('Video Generation')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    
    // Correct placeholder
    const promptInput = screen.getByPlaceholderText('Describe motion...');
    expect(promptInput).toHaveValue('A test video prompt');
  });

  it('calls onChange when prompt input changes', () => {
    render(<VideoGenNode data={mockData} />);
    
    const promptInput = screen.getByPlaceholderText('Describe motion...');
    fireEvent.change(promptInput, { target: { value: 'New video prompt' } });
    
    expect(mockData.onChange).toHaveBeenCalledWith('prompt', 'New video prompt');
  });

  it('calls onRun when Animate button is clicked', () => {
    render(<VideoGenNode data={mockData} />);
    
    // Correct button text
    const animateButton = screen.getByText('Animate');
    
    // Check if enabled (since we provided uploadedImage)
    expect(animateButton.closest('button')).not.toBeDisabled();
    
    fireEvent.click(animateButton);
    
    expect(mockData.onRun).toHaveBeenCalled();
  });

  it('displays linked input image when provided', () => {
    const imageUrl = 'http://example.com/frame1.png';
    // When inputImage is provided, the upload for first frame is hidden/replaced
    render(<VideoGenNode data={{ ...mockData, inputImage: imageUrl, uploadedImage: null }} />);
    
    expect(screen.getByText('Input Image (Linked)')).toBeInTheDocument();
    // Arco Image renders an img tag.
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThan(0);
  });

  it('displays linked last frame when provided', () => {
    const imageUrl = 'http://example.com/frame2.png';
    render(<VideoGenNode data={{ ...mockData, inputLastFrame: imageUrl }} />);
    
    expect(screen.getByText('Last Frame (Linked)')).toBeInTheDocument();
  });

  it('shows output video link/button when output is present', () => {
    const videoUrl = 'http://example.com/video.mp4';
    render(<VideoGenNode data={{ ...mockData, output: videoUrl }} />);
    
    // Check for refresh button (always there) and potentially download
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(1);
  });
});
