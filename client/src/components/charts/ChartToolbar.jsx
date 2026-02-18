import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import {
  Minus,
  MoveHorizontal,
  TrendingUp,
  Type,
  Ruler,
  Settings,
  Bell,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import LineToolButton from './LineToolButton';
import ShapeToolButton from './ShapeToolButton';
import MagnetToolButton from './MagnetToolButton';

const ChartToolbar = ({
  onToolSelect,
  activeTool: externalActiveTool = null,
  className,
  drawingsLocked = false,
  drawingsVisible = true,
  magnetMode = 'normal',
  onMagnetModeChange,
  onToggleLock,
  onToggleVisibility,
  onDeleteDrawings,
  onSettingsClick,
  onAlertsClick,
  activeIndicatorsCount = 0,
  onIndicatorsClick,
  indicatorsModalOpen = false,
}) => {
  const [internalActiveTool, setInternalActiveTool] = useState(null);
  
  // Use external activeTool if provided, otherwise use internal state
  const activeTool = externalActiveTool !== null ? externalActiveTool : internalActiveTool;

  const handleToolClick = (toolId) => {
    // Don't treat indicators, line-tools or shape-tools as regular drawing tools (they handle their own state)
    if (toolId === 'indicators' || toolId === 'line-tools' || toolId === 'shape-tools') {
      return;
    }
    if (toolId === 'crosshair') {
      if (onAlertsClick) {
        onAlertsClick();
      }
      return;
    }
    const newActiveTool = activeTool === toolId ? null : toolId;
    
    // Update internal state if external prop is not provided
    if (externalActiveTool === null) {
      setInternalActiveTool(newActiveTool);
    }
    
    if (onToolSelect) {
      onToolSelect(newActiveTool);
    }
  };

  const tools = [
    {
      id: 'line-tools',
      component: LineToolButton,
      label: 'Line Tools',
      description: 'Drawing line tools',
      props: {
        onToolSelect,
        activeTool: activeTool,
      },
    },
    {
      id: 'shape-tools',
      component: ShapeToolButton,
      label: 'Shapes',
      description: 'Circle, rectangle, parallelogram, triangle',
      props: {
        onToolSelect,
        activeTool: activeTool,
      },
    },
    {
      id: 'fibonacci',
      icon: TrendingUp,
      label: 'Fibonacci',
      description: 'Fibonacci retracement',
    },
    {
      id: 'text',
      icon: Type,
      label: 'Text',
      description: 'Text annotation',
    },
    {
      id: 'range-measurement',
      icon: Ruler,
      label: 'Range',
      description: 'Measure range: % change, bars, duration, volume',
    },
    {
      id: 'crosshair',
      icon: Bell,
      label: 'Measurement',
      description: 'Crosshair/measurement tool',
    },
  ];

  const actionButtons = [
    {
      id: 'settings',
      icon: Settings,
      label: 'Settings',
      description: 'Chart settings and indicators',
      onClick: onSettingsClick,
    },
    {
      id: 'alerts',
      icon: Bell,
      label: 'Alerts',
      description: 'Set price alerts',
      onClick: onAlertsClick,
    },
  ];

  const toggleButtons = [
    {
      id: 'magnet',
      component: MagnetToolButton,
      label: 'Magnet',
      description: 'Snap to candle levels',
      props: {
        magnetMode,
        onMagnetModeChange,
      },
    },
    {
      id: 'lock',
      icon: drawingsLocked ? Lock : Unlock,
      label: drawingsLocked ? 'Unlock' : 'Lock',
      description: drawingsLocked ? 'Unlock drawings' : 'Lock drawings',
      active: drawingsLocked,
      onClick: onToggleLock,
    },
    {
      id: 'visibility',
      icon: drawingsVisible ? Eye : EyeOff,
      label: drawingsVisible ? 'Hide' : 'Show',
      description: drawingsVisible ? 'Hide drawings' : 'Show drawings',
      active: drawingsVisible,
      onClick: onToggleVisibility,
    },
  ];

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 p-2 bg-surface border-r border-border',
        className
      )}
    >
      {/* Drawing Tools */}
      <div className="flex flex-col gap-1 mb-2">
        {tools.map((tool) => {
          // Handle custom component (like IndicatorsButton)
          if (tool.component) {
            const Component = tool.component;
            return (
              <div key={tool.id} className="w-14 flex justify-center">
                <Component
                  {...tool.props}
                />
              </div>
            );
          }

          // Handle regular icon tools
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              title={tool.description}
              className={cn(
                'relative h-10 w-14 rounded-lg border transition-all duration-150',
                'border-transparent hover:bg-surfaceHover hover:border-border/70',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
                isActive
                  ? 'bg-accent/15 text-accent border-accent/40 shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary'
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-border my-1" />

      {/* Action Buttons */}
      <div className="flex flex-col gap-1 mb-2">
        {actionButtons.map((button) => {
          const Icon = button.icon;
          const handleClick = button.onClick ?? (() => {});
          return (
            <button
              key={button.id}
              onClick={handleClick}
              title={button.description}
              type="button"
              className={cn(
                'h-10 w-14 rounded-lg transition-colors',
                'hover:bg-surfaceHover',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
                'text-textSecondary hover:text-textPrimary',
                !button.onClick && 'opacity-60 cursor-not-allowed'
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-border my-1" />

      {/* Toggle Buttons */}
      <div className="flex flex-col gap-1 mb-2">
        {toggleButtons.map((button) => {
          if (button.component) {
            const Component = button.component;
            return (
              <div key={button.id} className="w-14 flex justify-center">
                <Component {...button.props} />
              </div>
            );
          }
          const Icon = button.icon;
          const handleClick = button.onClick ?? (() => {});
          return (
            <button
              key={button.id}
              type="button"
              onClick={handleClick}
              title={button.description}
              className={cn(
                'h-10 w-14 rounded-lg transition-colors',
                'hover:bg-surfaceHover',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
                button.active
                  ? 'bg-surfaceHover text-accent'
                  : 'text-textSecondary hover:text-textPrimary'
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-border my-1" />

      {/* Delete Button */}
      <button
        type="button"
        onClick={onDeleteDrawings ?? (() => {})}
        title="Delete all drawings"
        className={cn(
          'h-10 w-14 rounded-lg transition-colors',
          'hover:bg-surfaceHover',
          'focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 focus:ring-offset-surface',
          'text-textSecondary hover:text-danger'
        )}
      >
        <Trash2 className="h-5 w-5" />
      </button>
    </div>
  );
};

export default ChartToolbar;
