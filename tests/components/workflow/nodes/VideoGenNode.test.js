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
    model: 'ep-20260415171928-pdvvr',
    prompt: 'A test video prompt',
    resolution: '720p',
    duration: 5,
    firstFrame: null,
    lastFrame: null,
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
    const promptInput = screen.getByPlaceholderText('Slow pan right...');
    expect(promptInput).toHaveValue('A test video prompt');
  });

  it('calls onChange when prompt input changes', () => {
    render(<VideoGenNode data={mockData} />);
    
    const promptInput = screen.getByPlaceholderText('Slow pan right...');
    fireEvent.change(promptInput, { target: { value: 'test prompt' } });
    
    expect(mockData.onChange).toHaveBeenCalledWith('prompt', 'test prompt');
  });

  it('calls onRun when Animate button is clicked', () => {
    render(<VideoGenNode data={mockData} />);
    
    // Correct button text
    const animateButton = screen.getByText('Animate');
    
    // Prompt alone is enough to enable the button.
    expect(animateButton.closest('button')).not.toBeDisabled();
    
    fireEvent.click(animateButton);
    
    expect(mockData.onRun).toHaveBeenCalled();
  });

  it('displays linked input image when provided', () => {
    const imageUrl = 'http://example.com/frame1.png';
    render(<VideoGenNode data={{ ...mockData, firstFrame: imageUrl }} />);
    
    expect(screen.getByText('First Frame')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', imageUrl);
  });

  it('displays linked last frame when provided', () => {
    const imageUrl = 'http://example.com/frame2.png';
    render(<VideoGenNode data={{ ...mockData, lastFrame: imageUrl }} />);
    
    expect(screen.getByText('Last Frame')).toBeInTheDocument();
    const images = screen.getAllByRole('img');
    expect(images.some((img) => img.getAttribute('src') === imageUrl)).toBe(true);
  });

  it('renders the Seedance 2.0 model option', () => {
    render(<VideoGenNode data={mockData} />);

    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Seedance 2.0');
  });

  it('shows output video link/button when output is present', () => {
    const videoUrl = 'http://example.com/video.mp4';
    render(<VideoGenNode data={{ ...mockData, output: videoUrl }} />);
    
    // Check for refresh button (always there) and potentially download
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(1);
  });
});
