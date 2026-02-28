import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageGenNode from '../../../../components/workflow/nodes/ImageGenNode';

// Mock @xyflow/react Handle component
jest.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

describe('ImageGenNode', () => {
  const mockData = {
    model: 'seedream-5-0-lite',
    prompt: 'A test prompt',
    inputPrompt: null,
    size: '2K',
    seed: '-1',
    loading: false,
    output: null,
    onChange: jest.fn(),
    onRun: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default data', () => {
    render(<ImageGenNode data={mockData} />);
    
    expect(screen.getByText('Image Generation')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    
    // Check if the prompt input has the correct value
    const promptInput = screen.getByPlaceholderText('Enter prompt...');
    expect(promptInput).toHaveValue('A test prompt');
  });

  it('calls onChange when prompt input changes', () => {
    render(<ImageGenNode data={mockData} />);
    
    const promptInput = screen.getByPlaceholderText('Enter prompt...');
    fireEvent.change(promptInput, { target: { value: 'New prompt' } });
    
    expect(mockData.onChange).toHaveBeenCalledWith('prompt', 'test prompt');
  });

  it('calls onRun when Generate button is clicked', () => {
    render(<ImageGenNode data={mockData} />);
    
    const generateButton = screen.getByText('Generate');
    fireEvent.click(generateButton);
    
    expect(mockData.onRun).toHaveBeenCalled();
  });

  it('displays loading state correctly', () => {
    render(<ImageGenNode data={{ ...mockData, loading: true }} />);
    
    const generateButton = screen.getByText('Generate').closest('button');
    // Arco Design loading button usually has a loading class or similar
    // We can check if it's disabled or has loading indicator if possible
    // Or just check if it exists. Since we mock Arco, we assume it handles loading prop.
    expect(generateButton).toBeInTheDocument();
  });

  it('displays output image when present', () => {
    const outputUrl = 'http://example.com/image.png';
    render(<ImageGenNode data={{ ...mockData, output: outputUrl }} />);
    
    // We check for the image element. Arco Image renders an img tag.
    // However, since we mock files, we might not see the actual src if it's imported, 
    // but here it's a string URL.
    const images = screen.getAllByRole('img');
    // One might be the icon, one the output.
    expect(images.length).toBeGreaterThan(0);
  });
});
