import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import {
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

  // Shared button style — compact square icon button matching TradingView style
  const btnBase = 'relative flex items-center justify-center h-16 w-16 rounded transition-colors duration-100 focus:outline-none focus:ring-1 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface';
  const btnIdle = 'text-textSecondary hover:text-textPrimary hover:bg-surfaceHover';
  const btnActive = 'bg-accent/15 text-accent';
  const btnDanger = 'text-textSecondary hover:text-danger hover:bg-surfaceHover';

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-0.5 py-2 px-1 bg-surface border-r border-border',
        className
      )}
    >
      {/* Drawing Tools */}
      <div className="flex flex-col items-center gap-0.5">
        {tools.map((tool) => {
          if (tool.component) {
            const Component = tool.component;
            return (
              <div key={tool.id} className="w-16 flex justify-center">
                <Component {...tool.props} />
              </div>
            );
          }

          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              title={tool.description}
              className={cn(btnBase, isActive ? btnActive : btnIdle)}
            >
              <Icon className="h-7 w-7" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-10 h-px bg-border my-1" />

      {/* Action Buttons */}
      <div className="flex flex-col items-center gap-0.5">
        {actionButtons.map((button) => {
          const Icon = button.icon;
          const handleClick = button.onClick ?? (() => {});
          return (
            <button
              key={button.id}
              onClick={handleClick}
              title={button.description}
              type="button"
              className={cn(btnBase, btnIdle, !button.onClick && 'opacity-50 cursor-not-allowed')}
            >
              <Icon className="h-7 w-7" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-10 h-px bg-border my-1" />

      {/* Toggle Buttons */}
      <div className="flex flex-col items-center gap-0.5">
        {toggleButtons.map((button) => {
          if (button.component) {
            const Component = button.component;
            return (
              <div key={button.id} className="w-16 flex justify-center">
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
                btnBase,
                button.active ? btnActive : btnIdle
              )}
            >
              <Icon className="h-7 w-7" />
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-10 h-px bg-border my-1" />

      {/* Delete Button */}
      <button
        type="button"
        onClick={onDeleteDrawings ?? (() => {})}
        title="Delete all drawings"
        className={cn(btnBase, btnDanger)}
      >
        <Trash2 className="h-7 w-7" />
      </button>
    </div>
  );
};

export default ChartToolbar;
