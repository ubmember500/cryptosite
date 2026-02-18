import React, { useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';
import { Edit3, Trash2 } from 'lucide-react';

/**
 * Menu that shows list of overlays when right-clicking on chart
 */
const OverlayListMenu = ({
  position,
  overlays,
  onEditOverlay,
  onDeleteOverlay,
  onClose,
}) => {
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (!overlays || overlays.length === 0) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        minWidth: '220px',
        maxHeight: '400px',
      }}
    >
      <div className="p-2">
        <div className="text-xs font-medium text-textSecondary uppercase tracking-wide px-2 py-1 mb-1">
          Drawn Lines ({overlays.length})
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {overlays.slice().reverse().map((overlay, index) => (
            <div
              key={overlay.id}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-md',
                'hover:bg-surfaceHover group'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-textPrimary truncate">
                  {overlay.name || overlay.type}
                </div>
                <div className="text-xs text-textSecondary">
                  {overlay.type}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onEditOverlay(overlay)}
                  title="Edit line"
                  className={cn(
                    'p-1.5 rounded hover:bg-accent hover:text-white',
                    'text-textSecondary transition-colors'
                  )}
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDeleteOverlay(overlay)}
                  title="Delete line"
                  className={cn(
                    'p-1.5 rounded hover:bg-danger hover:text-white',
                    'text-textSecondary transition-colors'
                  )}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OverlayListMenu;
