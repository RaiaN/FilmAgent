import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PromptEnhancerNode from '../../../../components/workflow/nodes/PromptEnhancerNode';

// Mock @xyflow/react Handle component
jest.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

describe('PromptEnhancerNode', () => {
  const mockData = {
    inputPrompt: 'Simple idea',
    outputPrompt: '',
    loading: false,
    onChange: jest.fn(),
    onRun: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<PromptEnhancerNode data={mockData} />);
    
    expect(screen.getByText('Prompt Enhancer')).toBeInTheDocument();
    expect(screen.getByText('Input Prompt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Simple idea')).toBeInTheDocument();
  });

  it('calls onChange when input prompt changes', () => {
    render(<PromptEnhancerNode data={mockData} />);
    
    const input = screen.getByDisplayValue('Simple idea');
    fireEvent.change(input, { target: { value: 'New idea' } });
    
    expect(mockData.onChange).toHaveBeenCalledWith('prompt', 'New idea');
  });

  it('calls onRun when Enhance button is clicked', () => {
    render(<PromptEnhancerNode data={mockData} />);
    
    const button = screen.getByText('Enhance');
    fireEvent.click(button);
    
    expect(mockData.onRun).toHaveBeenCalled();
  });

  it('displays enhanced output when present', () => {
    render(<PromptEnhancerNode data={{ ...mockData, outputPrompt: 'Enhanced idea' }} />);
    
    expect(screen.getByDisplayValue('Enhanced idea')).toBeInTheDocument();
  });
});
