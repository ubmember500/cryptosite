import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';
import {
  Minus,
  ChevronDown,
  MoveHorizontal,
  MoveVertical,
  Activity,
  Waypoints,
} from 'lucide-react';

/**
 * Line tool types available in KLineCharts
 */
const LINE_TYPES = [
  {
    id: 'straightLine',
    toolbarId: 'line',
    name: 'Trend Line',
    description: 'Infinite line in both directions',
    icon: Minus,
  },
  {
    id: 'rayLine',
    toolbarId: 'ray-line',
    name: 'Ray Line',
    description: 'Line extends in one direction',
    icon: Activity,
  },
  {
    id: 'segment',
    toolbarId: 'segment',
    name: 'Line Segment',
    description: 'Line between two points',
    icon: Waypoints,
  },
  {
    id: 'horizontalStraightLine',
    toolbarId: 'horizontal-line',
    name: 'Horizontal Line',
    description: 'Horizontal infinite line',
    icon: MoveHorizontal,
  },
  {
    id: 'verticalStraightLine',
    toolbarId: 'vertical-line',
    name: 'Vertical Line',
    description: 'Vertical infinite line',
    icon: MoveVertical,
  },
];

const LineToolButton = ({ 
  onToolSelect, 
  activeTool = null,
  className 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLineType, setSelectedLineType] = useState(LINE_TYPES[0]); // Default to Trend Line
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Check if any line tool is active
  const isAnyLineActive = LINE_TYPES.some(type => activeTool === type.toolbarId);
  const isCurrentLineActive = activeTool === selectedLineType.toolbarId;

  const handleMainButtonClick = () => {
    // Toggle the currently selected line tool
    if (onToolSelect) {
      const newTool = isCurrentLineActive ? null : selectedLineType.toolbarId;
      onToolSelect(newTool);
    }
  };

  const handleDropdownToggle = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleLineTypeSelect = (lineType) => {
    setSelectedLineType(lineType);
    setIsOpen(false);
    
    // Automatically activate the selected line type
    if (onToolSelect) {
      onToolSelect(lineType.toolbarId);
    }
  };

  const SelectedIcon = selectedLineType.icon;

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Main Button */}
      <div className="relative h-10 w-14">
        <button
          onClick={handleMainButtonClick}
          title={selectedLineType.description}
          className={cn(
            'relative h-10 w-14 rounded-lg border transition-all duration-150',
            'border-transparent hover:bg-surfaceHover hover:border-border/70',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
            isCurrentLineActive
              ? 'bg-accent/15 text-accent border-accent/40 shadow-sm'
              : 'text-textSecondary hover:text-textPrimary'
          )}
        >
          <SelectedIcon className="h-5 w-5" />
        </button>

        {/* Dropdown Toggle */}
        <button
          onClick={handleDropdownToggle}
          title="Select line type"
          className={cn(
            'absolute right-0 top-0 z-10 h-10 w-4 rounded-r-lg border-l border-border/50 transition-all duration-150',
            'border-transparent hover:bg-surfaceHover hover:border-border/70',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
            isCurrentLineActive
              ? 'bg-accent/15 text-accent border-accent/40'
              : 'text-textSecondary hover:text-textPrimary'
          )}
        >
          <ChevronDown className={cn(
            'h-2.5 w-2.5 transition-transform',
            isOpen && 'rotate-180'
          )} />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-full ml-2 top-0 z-50 w-56 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2">
            <div className="text-xs font-medium text-textSecondary uppercase tracking-wide px-2 py-1 mb-1">
              Line Tools
            </div>
            {LINE_TYPES.map((lineType) => {
              const Icon = lineType.icon;
              const isSelected = selectedLineType.id === lineType.id;
              const isActive = activeTool === lineType.toolbarId;
              
              return (
                <button
                  key={lineType.id}
                  onClick={() => handleLineTypeSelect(lineType)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors text-left',
                    'hover:bg-surfaceHover',
                    isSelected && 'bg-surfaceHover',
                    isActive && 'bg-accent/10 text-accent'
                  )}
                >
                  <div className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md',
                    isActive ? 'bg-accent text-white' : 'bg-surface text-textSecondary'
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      'text-sm font-medium',
                      isActive ? 'text-accent' : 'text-textPrimary'
                    )}>
                      {lineType.name}
                    </div>
                    <div className="text-xs text-textSecondary truncate">
                      {lineType.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default LineToolButton;
