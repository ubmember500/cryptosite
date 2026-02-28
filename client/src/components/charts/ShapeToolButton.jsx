import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';
import {
  Circle,
  Square,
  ChevronDown,
  Shapes,
  Triangle,
} from 'lucide-react';

/**
 * Shape tool types: Circle, Rectangle, Parallelogram, Triangle
 */
const SHAPE_TYPES = [
  {
    id: 'circle',
    toolbarId: 'circle',
    name: 'Circle',
    description: 'Draw a circle (center, then radius)',
    icon: Circle,
  },
  {
    id: 'rectangle',
    toolbarId: 'rectangle',
    name: 'Rectangle',
    description: 'Zones and areas',
    icon: Square,
  },
  {
    id: 'parallelogram',
    toolbarId: 'parallelogram',
    name: 'Parallelogram',
    description: 'Parallel lines / parallelogram',
    icon: Shapes,
  },
  {
    id: 'triangle',
    toolbarId: 'triangle',
    name: 'Triangle',
    description: 'Draw a triangle (3 points)',
    icon: Triangle,
  },
];

const ShapeToolButton = ({
  onToolSelect,
  activeTool = null,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedShapeType, setSelectedShapeType] = useState(SHAPE_TYPES[1]); // default Rectangle
  const [dropdownPos, setDropdownPos] = useState(null);
  const dropdownRef = useRef(null);
  const buttonAreaRef = useRef(null);

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

  const isAnyShapeActive = SHAPE_TYPES.some((type) => activeTool === type.toolbarId);
  const isCurrentShapeActive = activeTool === selectedShapeType.toolbarId;

  const handleMainButtonClick = () => {
    if (onToolSelect) {
      const newTool = isCurrentShapeActive ? null : selectedShapeType.toolbarId;
      onToolSelect(newTool);
    }
  };

  const handleDropdownToggle = (e) => {
    e.stopPropagation();
    if (!isOpen) {
      // Compute viewport-relative position so the dropdown escapes overflow:hidden parents
      const rect = buttonAreaRef.current?.getBoundingClientRect();
      if (rect) {
        setDropdownPos({ top: rect.top, left: rect.right + 8 });
      }
    }
    setIsOpen(!isOpen);
  };

  const handleShapeTypeSelect = (shapeType) => {
    setSelectedShapeType(shapeType);
    setIsOpen(false);
    if (onToolSelect) {
      onToolSelect(shapeType.toolbarId);
    }
  };

  const SelectedIcon = selectedShapeType.icon;

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <div ref={buttonAreaRef} className="relative h-16 w-16">
        <button
          onClick={handleMainButtonClick}
          title={selectedShapeType.description}
          className={cn(
            'relative flex items-center justify-center h-16 w-16 rounded transition-colors duration-100',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface',
            isCurrentShapeActive
              ? 'bg-accent/15 text-accent'
              : 'text-textSecondary hover:text-textPrimary hover:bg-surfaceHover'
          )}
        >
          <SelectedIcon className="h-7 w-7" />
          {/* Tiny dropdown indicator triangle at bottom-right */}
          <span
            onClick={handleDropdownToggle}
            title="Select shape"
            className="absolute bottom-[5px] right-[5px] w-0 h-0 cursor-pointer"
            style={{ borderLeft: '5px solid transparent', borderBottom: '5px solid currentColor', opacity: 0.6 }}
          />
        </button>
      </div>

      {/* Dropdown Menu — fixed positioning escapes overflow:hidden on parent chart container */}
      {isOpen && dropdownPos && (
        <div
          className="z-[9999] w-56 bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="p-2">
            <div className="text-xs font-medium text-textSecondary uppercase tracking-wide px-2 py-1 mb-1">
              Shapes
            </div>
            {SHAPE_TYPES.map((shapeType) => {
              const Icon = shapeType.icon;
              const isSelected = selectedShapeType.id === shapeType.id;
              const isActive = activeTool === shapeType.toolbarId;
              return (
                <button
                  key={shapeType.id}
                  onClick={() => handleShapeTypeSelect(shapeType)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors text-left',
                    'hover:bg-surfaceHover',
                    isSelected && 'bg-surfaceHover',
                    isActive && 'bg-accent/10 text-accent'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-md',
                      isActive ? 'bg-accent text-white' : 'bg-surface text-textSecondary'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'text-sm font-medium',
                        isActive ? 'text-accent' : 'text-textPrimary'
                      )}
                    >
                      {shapeType.name}
                    </div>
                    <div className="text-xs text-textSecondary truncate">
                      {shapeType.description}
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

export default ShapeToolButton;
