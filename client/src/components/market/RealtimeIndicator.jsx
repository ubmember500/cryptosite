import React from 'react';
import { cn } from '../../utils/cn';

/**
 * RealtimeIndicator Component
 * Shows the real-time WebSocket connection status for kline data
 * 
 * @param {boolean} isConnected - Whether WebSocket is connected
 * @param {boolean} isSubscribed - Whether actively subscribed to a kline stream
 */
const RealtimeIndicator = ({ isConnected, isSubscribed }) => {
  // Determine status and styling
  const getStatus = () => {
    if (isSubscribed && isConnected) {
      return {
        label: 'Live',
        dotClass: 'bg-success animate-pulse',
        textClass: 'text-success',
      };
    }
    
    if (isSubscribed && !isConnected) {
      return {
        label: 'Connecting...',
        dotClass: 'bg-warning',
        textClass: 'text-warning',
      };
    }
    
    return {
      label: 'Not live',
      dotClass: 'bg-textSecondary',
      textClass: 'text-textSecondary',
    };
  };

  const status = getStatus();

  return (
    <div className="flex items-center gap-2 text-xs">
      <div 
        className={cn(
          "w-2 h-2 rounded-full transition-colors",
          status.dotClass
        )} 
        title={`Real-time status: ${status.label}`}
      />
      <span className={cn("font-medium", status.textClass)}>
        {status.label}
      </span>
    </div>
  );
};

export default RealtimeIndicator;
