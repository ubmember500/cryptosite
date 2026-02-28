import React, { useRef, useEffect, useState } from 'react';
import { cn } from '../../utils/cn';
import { Trash2, GripHorizontal, ChevronUp, ChevronDown } from 'lucide-react';

const COLORS = [
  '#22d3ee', // cyan (default)
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#eab308', // yellow
  '#a855f7', // purple
  '#f97316', // orange
  '#ffffff', // white
];

const OverlayContextMenu = ({
  position,
  overlay,
  onColorChange,
  onSizeChange,
  onDelete,
  onClose,
}) => {
  const menuRef = useRef(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const currentColor = overlay?.styles?.line?.color || '#22d3ee';
  const currentSize = overlay?.styles?.line?.size || 1;
  const isMeasurementOverlay = overlay?.type === 'rangeMeasurement' || overlay?.name === 'rangeMeasurement';
  const isTextOverlay = overlay?.type === 'simpleAnnotation' || overlay?.name === 'simpleAnnotation';

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Clamp menu position to viewport
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!menuRef.current) {
      setAdjustedPos(position);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = position.x;
    let y = position.y + 12; // offset below click point
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (x < 8) x = 8;
    if (y + rect.height > vh - 8) y = position.y - rect.height - 12;
    if (y < 8) y = 8;
    setAdjustedPos({ x, y });
  }, [position]);

  const incrementSize = () => {
    const next = Math.min(currentSize + 1, 10);
    if (next !== currentSize) onSizeChange(next);
  };
  const decrementSize = () => {
    const next = Math.max(currentSize - 1, 1);
    if (next !== currentSize) onSizeChange(next);
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[100]"
      style={{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }}
    >
      {isMeasurementOverlay ? (
        <div className="flex items-center bg-surface border border-border rounded-lg shadow-2xl h-9 select-none">
          <button
            onClick={onDelete}
            className="flex items-center justify-center w-9 h-9 text-gray-400 hover:bg-red-600/20 hover:text-red-400 rounded-lg transition-colors"
            title={isTextOverlay ? 'Delete text' : 'Delete'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
      <div className="flex items-center gap-0 bg-surface border border-border rounded-lg shadow-2xl h-9 select-none">
        {/* Color dot */}
        <div className="relative">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex items-center justify-center w-9 h-9 hover:bg-surfaceHover rounded-l-lg transition-colors"
            title="Change color"
          >
            <span
              className="w-4 h-4 rounded-full border border-white/20"
              style={{ backgroundColor: currentColor }}
            />
          </button>

          {showColorPicker && (
            <div className="absolute top-full left-0 mt-1 p-2 bg-surface border border-border rounded-lg shadow-xl grid grid-cols-4 gap-1.5 z-10">
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    onColorChange(color);
                    setShowColorPicker(false);
                  }}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-all hover:scale-110',
                    currentColor === color
                      ? 'border-white scale-110'
                      : 'border-transparent hover:border-gray-500'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-border" />

        {/* Drag/move handle icon */}
        <button
          className="flex items-center justify-center w-8 h-9 text-textSecondary hover:bg-surfaceHover hover:text-textPrimary transition-colors cursor-grab"
          title="Move overlay"
        >
          <GripHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-border" />

        {/* Thickness input with up/down arrows */}
        <div className="flex items-center h-9 px-1">
          <div className="flex items-center bg-surfaceDark rounded-md border border-border h-7">
            <span className="text-xs text-textPrimary font-medium px-2 min-w-[32px] text-center tabular-nums">
              {currentSize}px
            </span>
            <div className="flex flex-col border-l border-border">
              <button
                onClick={incrementSize}
                className="flex items-center justify-center w-5 h-3.5 text-textSecondary hover:text-textPrimary hover:bg-surfaceHover rounded-tr-md transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                onClick={decrementSize}
                className="flex items-center justify-center w-5 h-3.5 text-textSecondary hover:text-textPrimary hover:bg-surfaceHover rounded-br-md transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-border" />

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="flex items-center justify-center w-9 h-9 text-gray-400 hover:bg-red-600/20 hover:text-red-400 rounded-r-lg transition-colors"
          title={isTextOverlay ? 'Delete text' : 'Delete'}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      )}
    </div>
  );
};

export default OverlayContextMenu;
