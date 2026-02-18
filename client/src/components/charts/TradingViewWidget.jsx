import React, { useEffect, useRef } from 'react';

const TradingViewWidget = ({ 
  symbol = 'BINANCE:BTCUSDT', 
  exchangeType = 'spot',
  interval = '15' 
}) => {
  const containerRef = useRef(null);
  const scriptRef = useRef(null);

  // Log component mount and prop changes
  console.log('[TradingViewWidget] Component rendered with props:', {
    symbol,
    exchangeType,
    interval,
    timestamp: new Date().toISOString()
  });

  // Log when container ref is set
  useEffect(() => {
    if (containerRef.current) {
      console.log('[TradingViewWidget] Container ref initialized:', {
        element: containerRef.current,
        id: containerRef.current.id || 'no-id',
        className: containerRef.current.className,
        parentElement: containerRef.current.parentElement?.tagName || 'no-parent'
      });
    } else {
      console.warn('[TradingViewWidget] Container ref not yet initialized');
    }
  }, []);

  // Convert interval format to TradingView format
  const convertInterval = (interval) => {
    // If already in TradingView format (number string), return as-is
    if (['1', '5', '15', '30', '60', '240', 'D'].includes(interval)) {
      return interval;
    }
    // Convert '15m' -> '15', '1h' -> '60', '4h' -> '240', '1d' -> 'D'
    const mapping = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '4h': '240',
      '1d': 'D'
    };
    return mapping[interval] || '15'; // Default to 15 minutes
  };

  useEffect(() => {
    // Log symbol prop received
    console.log('[TradingViewWidget] Props received:', { 
      symbol, 
      exchangeType, 
      interval,
      symbolType: typeof symbol,
      symbolLength: symbol?.length
    });
    
    if (!containerRef.current) {
      console.error('[TradingViewWidget] Container ref not available');
      return;
    }

    // Log container creation/verification
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    console.log('[TradingViewWidget] Container found:', {
      id: container.id || 'no-id',
      className: container.className,
      dimensions: {
        width: containerRect.width,
        height: containerRect.height
      },
      hasParent: !!container.parentElement
    });

    // Clean up previous widget
    console.log('[TradingViewWidget] Cleaning up previous widget');
    container.innerHTML = '';

    // Clean up previous script if it exists
    if (scriptRef.current && scriptRef.current.parentNode) {
      console.log('[TradingViewWidget] Removing previous script');
      scriptRef.current.parentNode.removeChild(scriptRef.current);
      scriptRef.current = null;
    }

    // Create configuration object
    const tradingViewInterval = convertInterval(interval || '15');
    const config = {
      symbol: symbol,
      interval: tradingViewInterval,
      theme: 'dark',
      style: '1', // Candlestick
      locale: 'en',
      toolbar_bg: '#1a1a1a',
      enable_publishing: false,
      allow_symbol_change: false,
      studies: ['Volume@tv-basicstudies'],
      drawing_toolbar: true,
      hide_side_toolbar: false,
      save_image: false,
      calendar: false,
      support_host: window.location.hostname || 'localhost',
    };

    // Log final configuration object
    console.log('[TradingViewWidget] Final configuration object:', JSON.stringify(config, null, 2));
    console.log('[TradingViewWidget] Configuration details:', {
      symbol: config.symbol,
      interval: config.interval,
      convertedInterval: tradingViewInterval,
      originalInterval: interval,
      supportHost: config.support_host
    });

    // Log script loading start
    console.log('[TradingViewWidget] Starting script load:', {
      scriptUrl: 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
      scriptType: 'text/javascript',
      async: true
    });

    // Create script element
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify(config);

    script.onload = () => {
      console.log('[TradingViewWidget] Script loaded successfully');
      console.log('[TradingViewWidget] Widget container after script load:', {
        containerChildren: container.children.length,
        containerHTML: container.innerHTML.substring(0, 200) + '...'
      });
      
      // Check if TradingView widget was created
      const widgetContainer = container.querySelector('.tradingview-widget-container__widget');
      if (widgetContainer) {
        console.log('[TradingViewWidget] Widget container created successfully:', {
          found: true,
          className: widgetContainer.className
        });
      } else {
        console.warn('[TradingViewWidget] Widget container not found after script load');
      }
    };

    script.onerror = (error) => {
      console.error('[TradingViewWidget] Failed to load TradingView script:', {
        error: error,
        errorType: error?.type,
        errorTarget: error?.target,
        scriptSrc: script.src,
        scriptReadyState: script.readyState
      });
      console.error('[TradingViewWidget] Script load error details:', error);
    };

    // Append script to container
    console.log('[TradingViewWidget] Appending script to container');
    try {
      container.appendChild(script);
      scriptRef.current = script;
      console.log('[TradingViewWidget] Script appended successfully');
    } catch (error) {
      console.error('[TradingViewWidget] Error appending script:', {
        error: error,
        errorMessage: error?.message,
        errorStack: error?.stack,
        container: container,
        script: script
      });
    }

    return () => {
      // Cleanup: remove script and clear container
      if (scriptRef.current && scriptRef.current.parentNode) {
        scriptRef.current.parentNode.removeChild(scriptRef.current);
        scriptRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval, exchangeType]);

  return (
    <div className="w-full h-full relative" style={{ minHeight: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{
          width: '100%',
          height: '100%',
          minHeight: '600px', // Ensure minimum height for visibility
        }}
      />
    </div>
  );
};

export default TradingViewWidget;
