import React from 'react';
import { cn } from '../../utils/cn';
import { Settings } from 'lucide-react';

/**
 * Button that appears in the toolbar to edit the selected overlay
 */
const EditOverlayButton = ({ 
  onClick,
  hasSelection = false,
  className 
}) => {
  if (!hasSelection) return null;

  return (
    <button
      onClick={onClick}
      title="Edit selected line"
      className={cn(
        'p-2 rounded-md transition-colors',
        'bg-accent text-white',
        'hover:bg-accent/90',
        'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
        'animate-pulse',
        className
      )}
    >
      <Settings className="h-5 w-5" />
    </button>
  );
};

export default EditOverlayButton;
