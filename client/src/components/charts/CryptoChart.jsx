import React, { useState, useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { cn } from '../../utils/cn';
import LoadingSpinner from '../common/LoadingSpinner';
import Button from '../common/Button';
import { RefreshCw, AlertCircle, Maximize, Minimize, Crosshair } from 'lucide-react';
import ChartToolbar from './ChartToolbar';
import IndicatorsButton from '../chart-ui/IndicatorsButton';
import IndicatorsModal from '../chart-ui/IndicatorsModal';
import { getThemePalette } from '../../utils/themePalette';

const CryptoChart = ({ 
  data, 
  className, 
  symbol = 'BTCUSDT',
  interval = '15m',
  loading = false,
  error = null,
  onTimeframeChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  chartRef: externalChartRef, // Allow external chart ref access
  measurementMode = false, // Enable measurement tool
  onMeasurementComplete, // Callback when measurement is complete
}) => {
  const [timeframe, setTimeframe] = useState(interval || '15m');
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange24h, setPriceChange24h] = useState(null);
  
  // Indicators state
  const [activeIndicators, setActiveIndicators] = useState([]);
  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState(false);

  const handleAddIndicator = (indicator) => {
    setActiveIndicators((prev) => [...prev, indicator]);
    // TODO: Implement actual indicator rendering on the chart
    console.log('Adding indicator:', indicator);
  };

  const handleRemoveIndicator = (indicatorValue) => {
    setActiveIndicators((prev) => prev.filter((ind) => ind.value !== indicatorValue));
    // TODO: Implement actual indicator removal from the chart
    console.log('Removing indicator:', indicatorValue);
  };

  // Drawing tool state
  const [activeDrawingTool, setActiveDrawingTool] = useState(null);
  const [drawings, setDrawings] = useState([]); // Store all drawings
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [internalMeasurementMode, setInternalMeasurementMode] = useState(measurementMode || false);
  
  // Drawing state for active drawing
  const [drawingStartPoint, setDrawingStartPoint] = useState(null);
  const [drawingCurrentPoint, setDrawingCurrentPoint] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Text tool state
  const [textInputs, setTextInputs] = useState([]);
  const [activeTextInput, setActiveTextInput] = useState(null);

  // Update internal measurement mode when prop changes
  useEffect(() => {
    setInternalMeasurementMode(measurementMode || false);
  }, [measurementMode]);

  const handleToggleMeasurementMode = () => {
    const newMode = !internalMeasurementMode;
    setInternalMeasurementMode(newMode);
    setActiveDrawingTool(null); // Deactivate other drawing tools when measurement is active
    console.log('Toggle measurement mode', newMode);
  };

  const handleClearDrawings = () => {
    clearMeasurement(); // Clear measurement tool drawings
    setDrawings([]); // Clear all drawings
    setTextInputs([]); // Clear text annotations
    console.log('Clear all drawings');
  };

  const handleToolSelect = (toolId) => {
    if (toolId === 'crosshair') {
      handleToggleMeasurementMode();
      return;
    }
    
    // Deactivate measurement mode when selecting other tools
    if (internalMeasurementMode) {
      setInternalMeasurementMode(false);
    }
    
    const newTool = activeDrawingTool === toolId ? null : toolId;
    setActiveDrawingTool(newTool);
    setIsDrawing(false);
    setDrawingStartPoint(null);
    setDrawingCurrentPoint(null);
  };

  // Measurement tool state
    const [measurementPoints, setMeasurementPoints] = useState([]);
  const [measurementHover, setMeasurementHover] = useState(null); // Current hover point for measurement
  
  // Force re-render when container gets dimensions
  const [containerReady, setContainerReadyState] = useState(false);
  
  // Chart initialization state
  const [isInitialized, setIsInitializedState] = useState(false);
  
  // Chart initialization error state
  const [chartError, setChartError] = useState(null);
  
  // Track initialization start time for timeout detection
  const initializationStartTimeRef = useRef(null);
  
  // Track if data has been loaded at least once (to distinguish first load from updates)
  const hasDataLoadedRef = useRef(false);
  
  // Wrapper functions for state setters with logging
  const setContainerReady = (value) => {
    const previousValue = containerReady;
    console.log('[CryptoChart] setContainerReady called:', {
      previousValue,
      newValue: value,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });
    setContainerReadyState(value);
  };
  
  const setIsInitialized = (value) => {
    const previousValue = isInitialized;
    const elapsedTime = initializationStartTimeRef.current 
      ? Date.now() - initializationStartTimeRef.current 
      : null;
    
    console.log('[CryptoChart] setIsInitialized called:', {
      previousValue,
      newValue: value,
      elapsedTime: elapsedTime ? `${elapsedTime}ms` : 'N/A',
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });
    
    // Warn if initialization takes more than 3 seconds
    if (value === true && elapsedTime && elapsedTime > 3000) {
      console.warn('[CryptoChart] ⚠️ Initialization took longer than 3 seconds:', {
        elapsedTime: `${elapsedTime}ms`,
        threshold: '3000ms',
        warning: 'This may indicate performance issues',
      });
    }
    
    setIsInitializedState(value);
  };
  
  // Refs for chart container and chart instance
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const priceLineRef = useRef(null);
  const measurementLineRef = useRef(null);
  const measurementOverlayRef = useRef(null);
  const drawingsOverlayRef = useRef(null);
  const nextDrawingIdRef = useRef(1);
  
  // Zoom limits configuration
  const ZOOM_LIMITS = {
    minCandleWidth: 0.5, // Minimum pixels per candle (prevent zooming too far in)
    maxVisibleCandles: 1000, // Maximum candles visible (prevent zooming too far out)
  };

  // Expose debug helpers to window for console debugging
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.debugCryptoChart = {
        getState: () => ({
          containerReady,
          isInitialized,
          chartError,
          hasContainerRef: !!chartContainerRef.current,
          hasChartRef: !!chartRef.current,
          hasCandlestickSeries: !!candlestickSeriesRef.current,
          hasVolumeSeries: !!volumeSeriesRef.current,
          containerDimensions: chartContainerRef.current ? {
            clientWidth: chartContainerRef.current.clientWidth,
            clientHeight: chartContainerRef.current.clientHeight,
            offsetWidth: chartContainerRef.current.offsetWidth,
            offsetHeight: chartContainerRef.current.offsetHeight,
          } : null,
          dataLength: data?.length || 0,
          hasDataLoaded: hasDataLoadedRef.current,
          initializationStartTime: initializationStartTimeRef.current,
        }),
        checkLightweightCharts: () => {
          console.log('✅ lightweight-charts createChart available:', typeof createChart === 'function');
          return typeof createChart === 'function';
        },
        testCreateChart: () => {
          if (!chartContainerRef.current) {
            console.error('❌ Container ref not available');
            return false;
          }
          try {
            const testChart = createChart(chartContainerRef.current, {
              width: 100,
              height: 100,
            });
            console.log('✅ Test chart created successfully:', testChart);
            testChart.remove();
            console.log('✅ Test chart removed');
            return true;
          } catch (error) {
            console.error('❌ Error creating test chart:', error);
            return false;
          }
        },
        forceReinitialize: () => {
          console.log('🔄 Forcing re-initialization...');
          setIsInitialized(false);
          setContainerReady(false);
          if (chartRef.current) {
            try {
              chartRef.current.remove();
            } catch (e) {
              console.error('Error removing chart:', e);
            }
            chartRef.current = null;
          }
          candlestickSeriesRef.current = null;
          volumeSeriesRef.current = null;
          initializationStartTimeRef.current = null;
          hasDataLoadedRef.current = false;
          setTimeout(() => {
            setContainerReady(true);
          }, 100);
        },
      };
      console.log('[CryptoChart] Debug helpers available at window.debugCryptoChart');
      console.log('[CryptoChart] Usage: window.debugCryptoChart.getState()');
    }
    
    return () => {
      if (typeof window !== 'undefined' && window.debugCryptoChart) {
        delete window.debugCryptoChart;
      }
    };
  }, [containerReady, isInitialized, chartError, data]);

  // Log component mount
  useEffect(() => {
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] 🎬 Component mounted');
    console.log('[CryptoChart] Initial props:', {
      symbol,
      interval,
      loading,
      error,
      measurementMode,
      dataLength: data?.length || 0,
      timestamp: new Date().toISOString(),
    });
    console.log('[CryptoChart] Initial state:', {
      timeframe,
      containerReady,
      isInitialized,
      chartError,
      currentPrice,
      priceChange24h,
    });
    
    // Check if lightweight-charts is available (using the ES module import from line 2)
    console.log('[CryptoChart] ✅ lightweight-charts createChart available:', typeof createChart === 'function');
    
    console.log('[CryptoChart] ========================================');
  }, []); // Only run on mount

  // Update timeframe when interval prop changes
  useEffect(() => {
    if (interval && interval !== timeframe) {
      setTimeframe(interval);
    }
  }, [interval, timeframe]);

  // Track containerReady state changes
  useEffect(() => {
    console.log('[CryptoChart] ContainerReady state changed:', {
      containerReady,
      timestamp: new Date().toISOString(),
      containerRef: !!chartContainerRef.current,
      containerDimensions: chartContainerRef.current ? {
        clientWidth: chartContainerRef.current.clientWidth,
        clientHeight: chartContainerRef.current.clientHeight,
        offsetWidth: chartContainerRef.current.offsetWidth,
        offsetHeight: chartContainerRef.current.offsetHeight,
      } : null,
    });
  }, [containerReady]);

  // Track isInitialized state changes
  useEffect(() => {
    const elapsedTime = initializationStartTimeRef.current 
      ? Date.now() - initializationStartTimeRef.current 
      : null;
    
    console.log('[CryptoChart] IsInitialized state changed:', {
      isInitialized,
      elapsedTime: elapsedTime ? `${elapsedTime}ms` : 'N/A',
      timestamp: new Date().toISOString(),
      hasChartRef: !!chartRef.current,
      hasCandlestickSeries: !!candlestickSeriesRef.current,
      hasVolumeSeries: !!volumeSeriesRef.current,
    });
    
    if (isInitialized && elapsedTime && elapsedTime > 3000) {
      console.warn('[CryptoChart] ⚠️ Chart initialization took longer than 3 seconds:', {
        elapsedTime: `${elapsedTime}ms`,
        threshold: '3000ms',
      });
    }
  }, [isInitialized]);

  // Log when container ref is set and mark as ready if it has dimensions
  useEffect(() => {
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] Container ref useEffect triggered');
    
    if (chartContainerRef.current) {
      const container = chartContainerRef.current;
      
      console.log('[CryptoChart] ✅ Container ref is set:', {
        element: container,
        tagName: container.tagName,
        className: container.className,
        id: container.id || 'no-id',
        parentElement: container.parentElement?.tagName || 'no-parent',
        timestamp: new Date().toISOString(),
      });
      
      // Force layout recalculation
      void container.offsetHeight;
      const computedStyle = window.getComputedStyle(container);
      void computedStyle.width;
      void computedStyle.height;
      
      // Check multiple dimension properties
      const width = Math.max(
        container.clientWidth,
        container.offsetWidth,
        container.scrollWidth,
        parseFloat(computedStyle.width) || 0
      );
      const height = Math.max(
        container.clientHeight,
        container.offsetHeight,
        container.scrollHeight,
        parseFloat(computedStyle.height) || 0
      );
      
      // Check parent dimensions as fallback
      let parentWidth = 0;
      let parentHeight = 0;
      if (container.parentElement) {
        const parent = container.parentElement;
        void parent.offsetHeight;
        const parentComputedStyle = window.getComputedStyle(parent);
        parentWidth = Math.max(
          parent.clientWidth,
          parent.offsetWidth,
          parent.scrollWidth,
          parseFloat(parentComputedStyle.width) || 0
        );
        parentHeight = Math.max(
          parent.clientHeight,
          parent.offsetHeight,
          parent.scrollHeight,
          parseFloat(parentComputedStyle.height) || 0
        );
      }
      
      console.log('[CryptoChart] Container dimensions check (ref set):', {
        containerDimensions: {
          width,
          height,
          clientWidth: container.clientWidth,
          clientHeight: container.clientHeight,
          offsetWidth: container.offsetWidth,
          offsetHeight: container.offsetHeight,
          scrollWidth: container.scrollWidth,
          scrollHeight: container.scrollHeight,
          computedWidth: computedStyle.width,
          computedHeight: computedStyle.height,
        },
        parentDimensions: container.parentElement ? {
          width: parentWidth,
          height: parentHeight,
        } : null,
        hasValidDimensions: width > 0 && height > 0,
        hasValidParentDimensions: parentWidth > 0 && parentHeight > 0,
      });
      
      // ALWAYS set containerReady when ref is set - don't wait for dimensions
      // Initialization will handle fallback dimensions if needed
      console.log('[CryptoChart] ✅ Container ref is set, marking as ready immediately');
      console.log('[CryptoChart] Container dimensions (for reference):', {
        width,
        height,
        parentWidth,
        parentHeight,
        note: 'Initialization will use fallback dimensions if needed',
      });
      setContainerReady(true);
    } else {
      console.log('[CryptoChart] ❌ Container ref not yet set');
    }
    
    console.log('[CryptoChart] ========================================');
  }, [data]); // Re-check when data becomes available (so ref can be attached)

  // Initialize chart
  useEffect(() => {
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] 🔄 INITIALIZATION useEffect RUNNING');
    console.log('[CryptoChart] useEffect dependencies:', {
      externalChartRef: externalChartRef,
      containerReady,
      timestamp: new Date().toISOString(),
    });
    console.log('[CryptoChart] Current state:', {
      containerRef: !!chartContainerRef.current,
      chartRef: !!chartRef.current,
      containerReady,
      isInitialized,
      chartError,
      timestamp: new Date().toISOString(),
    });
    
    // STEP 1: Check container ref
    console.log('[CryptoChart] STEP 1: Checking container ref...');
    if (!chartContainerRef.current) {
      console.log('[CryptoChart] ❌ STEP 1 FAILED: Container ref not available, aborting initialization');
      console.log('[CryptoChart] ========================================');
      return;
    }
    console.log('[CryptoChart] ✅ STEP 1 PASSED: Container ref available');

    // STEP 2: Check if chart already exists
    console.log('[CryptoChart] STEP 2: Checking if chart already exists...');
    if (chartRef.current) {
      console.log('[CryptoChart] ✅ STEP 2: Chart already initialized, skipping');
      console.log('[CryptoChart] ========================================');
      return;
    }
    console.log('[CryptoChart] ✅ STEP 2 PASSED: Chart does not exist, proceeding');

    const container = chartContainerRef.current;
    
    // Track initialization start time for timeout detection
    const startTime = Date.now();
    initializationStartTimeRef.current = startTime;
    
    console.log('[CryptoChart] 🚀 Starting chart initialization process...', {
      startTime: new Date(startTime).toISOString(),
      timestamp: startTime,
      containerReady,
      isInitialized,
      containerDimensions: {
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        offsetWidth: container.offsetWidth,
        offsetHeight: container.offsetHeight,
      },
    });
    
    // Clear any previous errors
    setChartError(null);
    
    // Wrap entire initialization in try-catch for error boundary
    try {
    
    // Set up timeout to detect stuck initialization
    let initializationTimeout = setTimeout(() => {
      if (!chartRef.current) {
        const elapsedTime = Date.now() - (initializationStartTimeRef.current || 0);
        console.error('[CryptoChart] ⚠️ Initialization timeout: Chart not initialized after 5 seconds');
        console.error('[CryptoChart] Debug info:', {
          containerRef: !!chartContainerRef.current,
          containerDimensions: chartContainerRef.current ? {
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            offsetWidth: chartContainerRef.current.offsetWidth,
            offsetHeight: chartContainerRef.current.offsetHeight,
          } : null,
          containerReady,
          isInitialized,
          chartError,
          elapsedTime: `${elapsedTime}ms`,
        });
        
        // Force initialization with fallback dimensions
        console.warn('[CryptoChart] Attempting to force initialization with fallback dimensions...');
        const fallbackWidth = 800;
        const fallbackHeight = 600;
        
        // Try to create chart with fallback dimensions as last resort
        if (chartContainerRef.current && !chartRef.current) {
          try {
            console.log('[CryptoChart] Creating chart with fallback dimensions as timeout fallback');
            const chart = createChart(chartContainerRef.current, {
              width: fallbackWidth,
              height: fallbackHeight,
              layout: {
                background: { color: '#0d1117' },
                textColor: '#e0e0e0',
                fontSize: 12,
                fontFamily: 'Inter, system-ui, sans-serif',
              },
            });
            chartRef.current = chart;
            setIsInitialized(true);
            console.log('[CryptoChart] ✅ Chart created successfully with fallback dimensions after timeout');
          } catch (error) {
            console.error('[CryptoChart] Failed to create chart even with fallback dimensions:', error);
            setChartError('Chart initialization timeout. The container may not have proper dimensions. Please try refreshing the page or selecting a different token.');
          }
        } else {
          setChartError('Chart initialization timeout. The container may not have proper dimensions. Please try refreshing the page or selecting a different token.');
        }
      }
    }, 5000);
    
    // Check container dimensions before initialization
    const checkDimensions = (useFallback = false) => {
      // Force layout recalculation by accessing offsetHeight and computed style
      // This ensures the browser has calculated layout before we check dimensions
      const forceLayout = () => {
        // Accessing offsetHeight forces a reflow
        void container.offsetHeight;
        // Accessing computed style also forces a reflow
        const computedStyle = window.getComputedStyle(container);
        void computedStyle.width;
        void computedStyle.height;
        return computedStyle;
      };
      
      const computedStyle = forceLayout();
      
      // Check multiple dimension properties and use the largest non-zero value
      const getBestWidth = () => {
        const clientWidth = container.clientWidth;
        const offsetWidth = container.offsetWidth;
        const scrollWidth = container.scrollWidth;
        const computedWidth = parseFloat(computedStyle.width) || 0;
        
        // Find the largest non-zero value
        const widths = [clientWidth, offsetWidth, scrollWidth, computedWidth].filter(w => w > 0);
        const bestWidth = widths.length > 0 ? Math.max(...widths) : 0;
        
        return {
          value: bestWidth,
          source: bestWidth === clientWidth ? 'clientWidth' :
                 bestWidth === offsetWidth ? 'offsetWidth' :
                 bestWidth === scrollWidth ? 'scrollWidth' :
                 bestWidth === computedWidth ? 'computedStyle.width' : 'none',
          allValues: { clientWidth, offsetWidth, scrollWidth, computedWidth },
        };
      };
      
      const getBestHeight = () => {
        const clientHeight = container.clientHeight;
        const offsetHeight = container.offsetHeight;
        const scrollHeight = container.scrollHeight;
        const computedHeight = parseFloat(computedStyle.height) || 0;
        
        // Find the largest non-zero value
        const heights = [clientHeight, offsetHeight, scrollHeight, computedHeight].filter(h => h > 0);
        const bestHeight = heights.length > 0 ? Math.max(...heights) : 0;
        
        return {
          value: bestHeight,
          source: bestHeight === clientHeight ? 'clientHeight' :
                 bestHeight === offsetHeight ? 'offsetHeight' :
                 bestHeight === scrollHeight ? 'scrollHeight' :
                 bestHeight === computedHeight ? 'computedStyle.height' : 'none',
          allValues: { clientHeight, offsetHeight, scrollHeight, computedHeight },
        };
      };
      
      const widthInfo = getBestWidth();
      const heightInfo = getBestHeight();
      const containerWidth = widthInfo.value;
      const containerHeight = heightInfo.value;
      
      const elapsedTime = initializationStartTimeRef.current 
        ? Date.now() - initializationStartTimeRef.current 
        : 0;
      
      console.log('[CryptoChart] Container dimensions check (initialization):', {
        width: {
          value: containerWidth,
          source: widthInfo.source,
          allValues: widthInfo.allValues,
        },
        height: {
          value: containerHeight,
          source: heightInfo.source,
          allValues: heightInfo.allValues,
        },
        computedStyle: {
          display: computedStyle.display,
          position: computedStyle.position,
          width: computedStyle.width,
          height: computedStyle.height,
        },
        useFallback,
        elapsedTime: `${elapsedTime}ms`,
        timestamp: new Date().toISOString(),
        containerState: {
          containerReady,
          isInitialized,
          hasChartRef: !!chartRef.current,
        },
      });
      
      // If container has valid dimensions, use them
      if (containerWidth > 0 && containerHeight > 0) {
        return { containerWidth, containerHeight, isFallback: false };
      }
      
      // Try parent container dimensions as fallback
      if (container.parentElement) {
        const parent = container.parentElement;
        const parentComputedStyle = window.getComputedStyle(parent);
        void parent.offsetHeight; // Force layout recalculation for parent
        
        const parentWidth = Math.max(
          parent.clientWidth,
          parent.offsetWidth,
          parent.scrollWidth,
          parseFloat(parentComputedStyle.width) || 0
        );
        const parentHeight = Math.max(
          parent.clientHeight,
          parent.offsetHeight,
          parent.scrollHeight,
          parseFloat(parentComputedStyle.height) || 0
        );
        
        console.log('[CryptoChart] Checking parent container dimensions:', {
          parentWidth,
          parentHeight,
          parentTag: parent.tagName,
          parentClass: parent.className,
          parentComputedStyle: {
            display: parentComputedStyle.display,
            width: parentComputedStyle.width,
            height: parentComputedStyle.height,
          },
        });
        
        // Use parent dimensions if they're valid
        if (parentWidth > 0 && parentHeight > 0) {
          console.log('[CryptoChart] Using parent container dimensions as fallback');
          return { 
            containerWidth: parentWidth, 
            containerHeight: parentHeight, 
            isFallback: true,
            source: 'parent',
          };
        }
      }
      
      // ALWAYS use fallback dimensions if actual dimensions are 0
      // This ensures initialization can proceed even if container isn't sized yet
      const fallbackWidth = 800;
      const fallbackHeight = 600;
      console.warn('[CryptoChart] ⚠️ Container has zero dimensions, using fallback dimensions immediately:', {
        fallbackWidth,
        fallbackHeight,
        note: 'Initialization will proceed with fallback dimensions. Chart will resize when container gets actual dimensions.',
      });
      return { containerWidth: fallbackWidth, containerHeight: fallbackHeight, isFallback: true, source: 'hardcoded' };
    };

    // STEP 3: Check dimensions
    console.log('[CryptoChart] STEP 3: Checking container dimensions...');
    const dimensionsResult = checkDimensions(false);
    const { containerWidth, containerHeight, isFallback } = dimensionsResult;
    console.log('[CryptoChart] ✅ STEP 3 PASSED: Got dimensions:', { 
      containerWidth, 
      containerHeight,
      isFallback,
    });
    
    // Set up timeout to resize chart if container gets actual dimensions later
    let timeoutId = setTimeout(() => {
      if (chartRef.current && chartContainerRef.current) {
        const container = chartContainerRef.current;
        
        // Force layout recalculation
        void container.offsetHeight;
        const computedStyle = window.getComputedStyle(container);
        void computedStyle.width;
        void computedStyle.height;
        
        // Check multiple dimension properties
        const currentWidth = Math.max(
          container.clientWidth,
          container.offsetWidth,
          container.scrollWidth,
          parseFloat(computedStyle.width) || 0
        );
        const currentHeight = Math.max(
          container.clientHeight,
          container.offsetHeight,
          container.scrollHeight,
          parseFloat(computedStyle.height) || 0
        );
        
        // Try parent dimensions if container still has zero dimensions
        let finalWidth = currentWidth;
        let finalHeight = currentHeight;
        if ((currentWidth === 0 || currentHeight === 0) && container.parentElement) {
          const parent = container.parentElement;
          void parent.offsetHeight;
          const parentComputedStyle = window.getComputedStyle(parent);
          const parentWidth = Math.max(
            parent.clientWidth,
            parent.offsetWidth,
            parent.scrollWidth,
            parseFloat(parentComputedStyle.width) || 0
          );
          const parentHeight = Math.max(
            parent.clientHeight,
            parent.offsetHeight,
            parent.scrollHeight,
            parseFloat(parentComputedStyle.height) || 0
          );
          
          if (parentWidth > 0 && parentHeight > 0) {
            finalWidth = parentWidth;
            finalHeight = parentHeight;
            console.log('[CryptoChart] Using parent dimensions from timeout fallback');
          }
        }
        
        // Resize chart if we got actual dimensions and they're different from fallback
        if (finalWidth > 0 && finalHeight > 0 && (finalWidth !== containerWidth || finalHeight !== containerHeight)) {
          console.log('[CryptoChart] Container got actual dimensions after timeout, resizing chart...', {
            oldWidth: containerWidth,
            oldHeight: containerHeight,
            newWidth: finalWidth,
            newHeight: finalHeight,
          });
          chartRef.current.applyOptions({
            width: finalWidth,
            height: finalHeight,
          });
        }
      }
    }, 500);
    
    // STEP 4: Create chart instance
    console.log('[CryptoChart] STEP 4: Creating chart instance...');
    console.log('[CryptoChart] About to call createChart() with:', {
      container: container,
      containerType: typeof container,
      containerTag: container.tagName,
      width: containerWidth,
      height: containerHeight,
      timestamp: new Date().toISOString(),
    });
    const themeColors = getThemePalette();
    
    // Wrap chart creation in try-catch for error handling
      chart = createChart(container, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        background: { color: themeColors.surface },
        textColor: themeColors.textPrimary,
        fontSize: 12,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: {
          color: themeColors.border,
          visible: false,
        },
        horzLines: {
          color: themeColors.border,
          visible: false,
        },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: themeColors.border,
          width: 1,
          style: 0,
          labelBackgroundColor: themeColors.surface,
        },
        horzLine: {
          color: themeColors.border,
          width: 1,
          style: 0,
          labelBackgroundColor: themeColors.surface,
        },
      },
      rightPriceScale: {
        borderColor: themeColors.border,
        scaleMargins: {
          top: 0.1,
          bottom: 0.4,
        },
        entireTextOnly: true,
        ticksVisible: true,
        borderVisible: true,
        autoScale: true,
      },
      timeScale: {
        borderColor: themeColors.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 6,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
        rightBarStaysOnScroll: true,
        allowShiftVisibleRangeOnWhitespaceClick: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
        pinch: true,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
    });
        axisDoubleClickReset: true, // Double-click to reset zoom
        mouseWheel: true, // Mouse wheel zoom
        pinch: true, // Pinch zoom for touch devices
      },
    });
      
      console.log('[CryptoChart] ✅ createChart() CALLED SUCCESSFULLY');
      console.log('[CryptoChart] Chart instance created:', {
        chart,
        chartType: typeof chart,
        hasContainer: !!chart.container(),
        container: chart.container(),
        width: chart.width(),
        height: chart.height(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[CryptoChart] ❌ STEP 4 FAILED: Error creating chart instance:', {
        error,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        container: container,
        containerDimensions: { containerWidth, containerHeight },
        timestamp: new Date().toISOString(),
      });
      setChartError(`Failed to initialize chart: ${error.message}`);
      throw error; // Re-throw to be caught by outer try-catch
    }

    // STEP 5: Set chart ref
    console.log('[CryptoChart] STEP 5: Setting chartRef.current...');
    chartRef.current = chart;
    console.log('[CryptoChart] ✅ STEP 5 PASSED: chartRef.current set:', {
      chartRef: !!chartRef.current,
      chartRefValue: chartRef.current,
      timestamp: new Date().toISOString(),
    });

    // STEP 6: Create candlestick series
    console.log('[CryptoChart] STEP 6: Creating candlestick series...');
    let candlestickSeries;
    try {
      console.log('[CryptoChart] About to call chart.addCandlestickSeries()...');
      candlestickSeries = chart.addCandlestickSeries({
      upColor: themeColors.success,
      downColor: themeColors.danger,
      borderVisible: false,
      wickUpColor: themeColors.success,
      wickDownColor: themeColors.danger,
      priceScaleId: 'right',
      priceFormat: {
        type: 'price',
        precision: 8,
        minMove: 0.00000001,
      },
    });
      
      console.log('[CryptoChart] ✅ STEP 6 PASSED: Candlestick series created successfully:', {
        series: candlestickSeries,
        seriesType: typeof candlestickSeries,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[CryptoChart] ❌ STEP 6 FAILED: Error creating candlestick series:', {
        error,
        errorMessage: error.message,
        errorStack: error.stack,
        timestamp: new Date().toISOString(),
      });
      setChartError(`Failed to create candlestick series: ${error.message}`);
      setIsInitialized(false); // Ensure initialized state is false on error
      // Clean up chart if series creation fails
      try {
        chart.remove();
        console.log('[CryptoChart] Chart cleaned up after candlestick series error');
      } catch (cleanupError) {
        console.error('[CryptoChart] Error cleaning up chart:', cleanupError);
      }
      throw error; // Re-throw to be caught by outer try-catch
    }

    console.log('[CryptoChart] Setting candlestickSeriesRef.current...');
    candlestickSeriesRef.current = candlestickSeries;
    console.log('[CryptoChart] ✅ candlestickSeriesRef.current set:', {
      hasRef: !!candlestickSeriesRef.current,
      timestamp: new Date().toISOString(),
    });

    // STEP 7: Create volume series
    console.log('[CryptoChart] STEP 7: Creating volume series...');
    let volumeSeries;
    try {
      console.log('[CryptoChart] About to call chart.addHistogramSeries()...');
      volumeSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
      scaleMargins: {
        top: 0.7, // Position volume at bottom 30% of chart
        bottom: 0,
      },
      priceLineVisible: false,
      lastValueVisible: false,
      });
      
      console.log('[CryptoChart] ✅ STEP 7 PASSED: Volume series created successfully:', {
        series: volumeSeries,
        seriesType: typeof volumeSeries,
        timestamp: new Date().toISOString(),
      });
      volumeSeriesRef.current = volumeSeries;
      console.log('[CryptoChart] ✅ volumeSeriesRef.current set');
    } catch (error) {
      console.error('[CryptoChart] ⚠️ STEP 7 WARNING: Error creating volume series (non-critical):', {
        error,
        errorMessage: error.message,
        errorStack: error.stack,
        timestamp: new Date().toISOString(),
      });
      // Note: Chart and candlestick series are already created, so we continue
      // Volume series is optional - don't set chartError for this
      volumeSeriesRef.current = null;
      console.log('[CryptoChart] Continuing without volume series (it is optional)');
    }
    
    // Ensure chart is marked as initialized even if volume series failed
    // Volume series is optional, so chart can still function without it

    // STEP 8: Configure volume price scale
    console.log('[CryptoChart] STEP 8: Configuring volume price scale...');
    try {
      chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.7,
        bottom: 0,
      },
      visible: false, // Hide volume price scale
      });
      console.log('[CryptoChart] ✅ STEP 8 PASSED: Volume price scale configured successfully');
    } catch (error) {
      console.error('[CryptoChart] ⚠️ STEP 8 WARNING: Error configuring volume price scale (non-critical):', {
        error,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      // Non-critical error, continue
    }

    // STEP 9: Apply zoom limits
    console.log('[CryptoChart] STEP 9: Applying zoom limits...');
    const applyZoomLimits = () => {
      if (!chartRef.current) {
        console.warn('[CryptoChart] Cannot apply zoom limits: chart ref not available');
        return;
      }
      
      try {
        const timeScale = chartRef.current.timeScale();
        
        // Set minimum bar spacing (prevents zooming too far in)
        timeScale.applyOptions({
          minBarSpacing: ZOOM_LIMITS.minCandleWidth,
        });
        console.log('[CryptoChart] ✅ Zoom limits applied successfully');
      } catch (error) {
        console.error('[CryptoChart] ⚠️ Error applying zoom limits (non-critical):', {
          error,
          errorMessage: error.message,
          errorStack: error.stack,
        });
      }
    };

    applyZoomLimits();
    console.log('[CryptoChart] ✅ STEP 9 PASSED: Zoom limits applied');
    
    // Calculate initialization duration
    const endTime = Date.now();
    const initDuration = initializationStartTimeRef.current 
      ? endTime - initializationStartTimeRef.current 
      : 0;
    
    // STEP 10: Mark chart as initialized - ALWAYS call this after successful chart creation
    // Chart initialization is independent of data - chart can display empty/placeholder until data arrives
    console.log('[CryptoChart] STEP 10: Marking chart as initialized...');
    console.log('[CryptoChart] About to call setIsInitialized(true)...');
    console.log('[CryptoChart] Current state before setIsInitialized:', {
      isInitialized,
      hasChartRef: !!chartRef.current,
      hasCandlestickSeries: !!candlestickSeriesRef.current,
      hasVolumeSeries: !!volumeSeriesRef.current,
      hasData: !!(data && data.length > 0),
      dataLength: data?.length || 0,
      timestamp: new Date().toISOString(),
    });
    
    console.log('[CryptoChart] ✅ Chart initialization completed successfully, calling setIsInitialized(true)');
    console.log('[CryptoChart] Note: Chart initialized independently of data. Data will be loaded separately.');
    console.log('[CryptoChart] Initialization timing:', {
      startTime: initializationStartTimeRef.current 
        ? new Date(initializationStartTimeRef.current).toISOString() 
        : 'N/A',
      endTime: new Date(endTime).toISOString(),
      duration: `${initDuration}ms`,
      durationSeconds: (initDuration / 1000).toFixed(2),
    });
    
    setIsInitialized(true);
    console.log('[CryptoChart] ✅ STEP 10 COMPLETE: setIsInitialized(true) called');
    console.log('[CryptoChart] Chart will now be displayed even if data is not loaded yet');
    
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] 📊 Chart initialization summary:', {
      success: true,
      duration: `${initDuration}ms`,
      durationSeconds: (initDuration / 1000).toFixed(2),
      usedFallbackDimensions: isFallback,
      chartWidth: containerWidth,
      chartHeight: containerHeight,
      startTime: initializationStartTimeRef.current 
        ? new Date(initializationStartTimeRef.current).toISOString() 
        : 'N/A',
      endTime: new Date(endTime).toISOString(),
      timestamp: endTime,
    });
    
    // Warn if initialization took longer than 3 seconds
    if (initDuration > 3000) {
      console.warn('[CryptoChart] ⚠️ WARNING: Initialization took longer than 3 seconds:', {
        duration: `${initDuration}ms`,
        threshold: '3000ms',
        exceededBy: `${initDuration - 3000}ms`,
        warning: 'This may indicate performance issues or layout problems',
      });
    }
    
    // Log if fallback dimensions were used
    if (isFallback) {
      console.warn('[CryptoChart] ⚠️ Chart initialized with fallback dimensions - ResizeObserver will update with actual dimensions');
    }
    
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] ✅ ALL INITIALIZATION STEPS COMPLETED SUCCESSFULLY');
    
    // Cleanup function for timeouts
    return () => {
      console.log('[CryptoChart] 🧹 Cleanup: Cleaning up initialization timeouts...');
      if (initializationTimeout) {
        clearTimeout(initializationTimeout);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    } catch (error) {
      // Error boundary - catch any errors during initialization
      console.error('[CryptoChart] ========================================');
      console.error('[CryptoChart] ❌ INITIALIZATION FAILED - ERROR BOUNDARY CAUGHT ERROR');
      console.error('[CryptoChart] Error details:', {
        error,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        timestamp: new Date().toISOString(),
        initializationState: {
          containerRef: !!chartContainerRef.current,
          chartRef: !!chartRef.current,
          containerReady,
          isInitialized,
        },
      });
      
      // Set error state so user sees error message instead of infinite loading
      setChartError(`Chart initialization failed: ${error.message}. Please try refreshing the page.`);
      setIsInitialized(false);
      
      // Clean up any partial initialization
      if (chartRef.current) {
        try {
          chartRef.current.remove();
          chartRef.current = null;
          console.log('[CryptoChart] Cleaned up partial chart instance');
        } catch (cleanupError) {
          console.error('[CryptoChart] Error cleaning up chart:', cleanupError);
        }
      }
      
      console.error('[CryptoChart] ========================================');
    }
    
    // Handle resize with dimension validation
    const handleResize = (entries) => {
      if (!chartContainerRef.current || !chartRef.current) {
        return;
      }

      const container = chartContainerRef.current;
      
      // Force layout recalculation
      void container.offsetHeight;
      const computedStyle = window.getComputedStyle(container);
      void computedStyle.width;
      void computedStyle.height;
      
      // Check multiple dimension properties and use the largest
      const width = Math.max(
        container.clientWidth,
        container.offsetWidth,
        container.scrollWidth,
        parseFloat(computedStyle.width) || 0
      );
      const height = Math.max(
        container.clientHeight,
        container.offsetHeight,
        container.scrollHeight,
        parseFloat(computedStyle.height) || 0
      );

      console.log('[CryptoChart] Resize detected:', { 
        width, 
        height,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        offsetWidth: container.offsetWidth,
        offsetHeight: container.offsetHeight,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
        computedWidth: computedStyle.width,
        computedHeight: computedStyle.height,
      });

      // Only update if dimensions are valid
      if (width > 0 && height > 0) {
        chartRef.current.applyOptions({
          width,
          height,
        });
        // Reapply zoom limits after resize
        applyZoomLimits();
      } else {
        // Try parent dimensions as fallback
        if (container.parentElement) {
          const parent = container.parentElement;
          void parent.offsetHeight;
          const parentComputedStyle = window.getComputedStyle(parent);
          const parentWidth = Math.max(
            parent.clientWidth,
            parent.offsetWidth,
            parent.scrollWidth,
            parseFloat(parentComputedStyle.width) || 0
          );
          const parentHeight = Math.max(
            parent.clientHeight,
            parent.offsetHeight,
            parent.scrollHeight,
            parseFloat(parentComputedStyle.height) || 0
          );
          
          if (parentWidth > 0 && parentHeight > 0) {
            console.log('[CryptoChart] Using parent dimensions for resize:', { width: parentWidth, height: parentHeight });
            chartRef.current.applyOptions({
              width: parentWidth,
              height: parentHeight,
            });
            applyZoomLimits();
          } else {
            console.warn('[CryptoChart] Invalid dimensions during resize (container and parent):', { 
              container: { width, height },
              parent: { width: parentWidth, height: parentHeight },
            });
          }
        } else {
          console.warn('[CryptoChart] Invalid dimensions during resize:', { width, height });
        }
      }
    };

    // Use ResizeObserver for better resize detection and initial sizing
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && chartContainerRef.current) {
        const container = chartContainerRef.current;
        
        // Force layout recalculation
        void container.offsetHeight;
        const computedStyle = window.getComputedStyle(container);
        void computedStyle.width;
        void computedStyle.height;
        
        // Check multiple dimension properties
        const width = Math.max(
          container.clientWidth,
          container.offsetWidth,
          container.scrollWidth,
          parseFloat(computedStyle.width) || 0,
          entry.contentRect.width || 0
        );
        const height = Math.max(
          container.clientHeight,
          container.offsetHeight,
          container.scrollHeight,
          parseFloat(computedStyle.height) || 0,
          entry.contentRect.height || 0
        );
        
        console.log('[CryptoChart] ResizeObserver triggered:', { 
          width, 
          height,
          contentRect: entry.contentRect,
          clientWidth: container.clientWidth,
          clientHeight: container.clientHeight,
          offsetWidth: container.offsetWidth,
          offsetHeight: container.offsetHeight,
        });
        
        // If chart wasn't initialized due to zero dimensions, mark container as ready
        // This will trigger the initialization effect to re-run
        if (!chartRef.current) {
          console.log('[CryptoChart] ResizeObserver: Chart not initialized yet, checking dimensions...');
          console.log('[CryptoChart] ResizeObserver dimensions check:', {
            width,
            height,
            container: {
              clientWidth: container.clientWidth,
              clientHeight: container.clientHeight,
              offsetWidth: container.offsetWidth,
              offsetHeight: container.offsetHeight,
              scrollWidth: container.scrollWidth,
              scrollHeight: container.scrollHeight,
            },
            contentRect: entry.contentRect,
            timestamp: new Date().toISOString(),
          });
          
          if (width > 0 && height > 0) {
            console.log('[CryptoChart] ✅ Container now has dimensions, marking as ready for initialization');
            setContainerReady(true);
            return;
          } else {
            // Try parent dimensions as fallback
            if (container.parentElement) {
              const parent = container.parentElement;
              void parent.offsetHeight;
              const parentComputedStyle = window.getComputedStyle(parent);
              const parentWidth = Math.max(
                parent.clientWidth,
                parent.offsetWidth,
                parent.scrollWidth,
                parseFloat(parentComputedStyle.width) || 0
              );
              const parentHeight = Math.max(
                parent.clientHeight,
                parent.offsetHeight,
                parent.scrollHeight,
                parseFloat(parentComputedStyle.height) || 0
              );
              
              console.log('[CryptoChart] Checking parent dimensions:', {
                parentWidth,
                parentHeight,
                parentTag: parent.tagName,
                parentClass: parent.className,
              });
              
              if (parentWidth > 0 && parentHeight > 0) {
                console.log('[CryptoChart] ✅ Using parent dimensions from ResizeObserver, marking as ready');
                setContainerReady(true);
                return;
              }
            }
            
            // Still zero dimensions - log for debugging
            console.warn('[CryptoChart] ⚠️ ResizeObserver detected but dimensions still zero:', { 
              width, 
              height,
              container: {
                clientWidth: container.clientWidth,
                clientHeight: container.clientHeight,
                offsetWidth: container.offsetWidth,
                offsetHeight: container.offsetHeight,
              },
              timestamp: new Date().toISOString(),
            });
            
            // Fallback: Use default dimensions after a delay if container still has no dimensions
            // This helps with edge cases where ResizeObserver might not fire immediately
            setTimeout(() => {
              if (!chartRef.current && chartContainerRef.current) {
                const currentWidth = Math.max(
                  chartContainerRef.current.clientWidth,
                  chartContainerRef.current.offsetWidth,
                  chartContainerRef.current.scrollWidth
                );
                const currentHeight = Math.max(
                  chartContainerRef.current.clientHeight,
                  chartContainerRef.current.offsetHeight,
                  chartContainerRef.current.scrollHeight
                );
                if (currentWidth === 0 || currentHeight === 0) {
                  console.warn('[CryptoChart] Container still has zero dimensions after delay, this may indicate a layout issue');
                }
              }
            }, 1000);
          }
        }
        
        // Only handle resize if chart is already initialized
        if (chartRef.current) {
          handleResize(entries);
        }
      }
    });

    if (container) {
      resizeObserver.observe(container);
    }

    // Expose chart ref externally if provided
    if (externalChartRef) {
      externalChartRef.current = chart;
    }

    // Cleanup
    return () => {
      console.log('[CryptoChart] Cleaning up chart...');
      try {
        resizeObserver.disconnect();
        console.log('[CryptoChart] ResizeObserver disconnected');
      } catch (error) {
        console.error('[CryptoChart] Error disconnecting ResizeObserver:', error);
      }
      
      if (chartRef.current) {
        try {
          console.log('[CryptoChart] Removing chart instance...');
          chartRef.current.remove();
          console.log('[CryptoChart] Chart instance removed successfully');
        } catch (error) {
          console.error('[CryptoChart] Error removing chart instance:', {
            error,
            errorMessage: error.message,
            errorStack: error.stack,
          });
        }
        chartRef.current = null;
      }
      
      if (externalChartRef) {
        externalChartRef.current = null;
        console.log('[CryptoChart] External chart ref cleared');
      }
      
      // Cleanup drawing overlays
      if (drawingsOverlayRef.current) {
        drawingsOverlayRef.current.remove();
        drawingsOverlayRef.current = null;
      }
      
      // Cleanup text inputs
      if (chartContainerRef.current) {
        const textInputs = chartContainerRef.current.querySelectorAll('[id^="text-input-"]');
        textInputs.forEach((input) => input.remove());
      }
      
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      console.log('[CryptoChart] 🧹 Cleanup: Resetting initialization state');
      setIsInitialized(false); // Reset initialization state on cleanup
      setContainerReady(false); // Reset container ready state
      initializationStartTimeRef.current = null; // Clear initialization start time
      console.log('[CryptoChart] ✅ Cleanup completed');
    };
  }, [externalChartRef, containerReady]); // Re-run when container becomes ready (removed isInitialized to prevent loops) (not isInitialized to avoid loops)

  // Zoom functions
  const handleZoomIn = () => {
    if (!chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    
    if (!visibleRange) return;
    
    const range = visibleRange.to - visibleRange.from;
    const center = (visibleRange.from + visibleRange.to) / 2;
    const newRange = range * 0.7; // Zoom in by 30%
    
    // Check zoom limits
    const containerWidth = chartContainerRef.current?.clientWidth || 800;
    const candlesVisible = containerWidth / ZOOM_LIMITS.minCandleWidth;
    
    if (newRange < candlesVisible) {
      // Don't zoom in beyond minimum candle width
      return;
    }
    
    const newFrom = center - newRange / 2;
    const newTo = center + newRange / 2;
    
    timeScale.setVisibleRange({
      from: newFrom,
      to: newTo,
    });
  };

  const handleZoomOut = () => {
    if (!chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    
    if (!visibleRange) return;
    
    const range = visibleRange.to - visibleRange.from;
    const center = (visibleRange.from + visibleRange.to) / 2;
    const newRange = range * 1.3; // Zoom out by 30%
    
    // Check zoom limits - don't zoom out beyond max visible candles
    if (newRange > ZOOM_LIMITS.maxVisibleCandles) {
      // Don't zoom out beyond maximum
      return;
    }
    
    const newFrom = center - newRange / 2;
    const newTo = center + newRange / 2;
    
    timeScale.setVisibleRange({
      from: newFrom,
      to: newTo,
    });
  };

  const handleResetZoom = () => {
    if (!chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    timeScale.fitContent();
    
    // Call external callback if provided
    if (onResetZoom) {
      onResetZoom();
    }
  };

  // Measurement tool functions
  const calculateMeasurement = (point1, point2) => {
    const priceDiff = point2.price - point1.price;
    const priceDiffAbs = Math.abs(priceDiff);
    const pricePercent = ((point2.price - point1.price) / point1.price) * 100;
    const timeDiff = point2.time - point1.time;
    const timeDiffSeconds = timeDiff;
    const timeDiffFormatted = formatTimeDifference(timeDiffSeconds);
    
    return {
      point1: { time: point1.time, price: point1.price },
      point2: { time: point2.time, price: point2.price },
      priceDiff,
      priceDiffAbs,
      pricePercent,
      timeDiff,
      timeDiffFormatted,
    };
  };

  const formatTimeDifference = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const createMeasurementLine = (point1, point2) => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;
    
    // Remove existing measurement line
    if (measurementLineRef.current) {
      candlestickSeriesRef.current.removePriceLine(measurementLineRef.current);
    }
    
    // Create line series for measurement (we'll use price lines as markers)
    // Actually, Lightweight Charts doesn't have direct line drawing between arbitrary points
    // We'll create an overlay using HTML/CSS instead
    updateMeasurementOverlay(point1, point2);
  };

  const updateMeasurementPreview = (point1, point2) => {
    updateMeasurementOverlay(point1, point2, true);
  };

  const updateMeasurementOverlay = (point1, point2, isPreview = false) => {
    if (!chartContainerRef.current) return;
    
    let overlay = measurementOverlayRef.current;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      overlay.className = 'measurement-overlay';
      chartContainerRef.current.appendChild(overlay);
      measurementOverlayRef.current = overlay;
    }
    
    const measurement = calculateMeasurement(point1, point2);
    const formattedText = formatMeasurementText(measurement);
    
    // Calculate line position
    const x1 = point1.x;
    const y1 = point1.y;
    const x2 = point2.x;
    const y2 = point2.y;
    
    const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    
    overlay.innerHTML = `
      <div style="
        position: absolute;
        left: ${Math.min(x1, x2)}px;
        top: ${Math.min(y1, y2)}px;
        width: ${length}px;
        height: 2px;
        background: ${isPreview ? '#53698580' : '#536985'};
        transform-origin: 0 50%;
        transform: rotate(${angle}deg);
        pointer-events: none;
      "></div>
      <div style="
        position: absolute;
        left: ${centerX}px;
        top: ${centerY - 30}px;
        transform: translateX(-50%);
        background: #1a1a1a;
        border: 1px solid #536985;
        border-radius: 4px;
        padding: 4px 8px;
        color: #e0e0e0;
        font-size: 11px;
        font-family: Inter, sans-serif;
        white-space: nowrap;
        pointer-events: none;
        ${isPreview ? 'opacity: 0.7;' : ''}
      ">${formattedText}</div>
    `;
  };

  const formatMeasurementText = (measurement) => {
    // Dynamic precision for prices
    const getPrecision = (price) => {
      if (price >= 1000) return 2;
      if (price >= 10) return 4;
      if (price >= 1) return 4;
      if (price >= 0.01) return 6;
      return 8;
    };
    
    const avgPrice = (measurement.point1.price + measurement.point2.price) / 2;
    const precision = getPrecision(avgPrice);
    
    const price1 = measurement.point1.price.toFixed(precision);
    const price2 = measurement.point2.price.toFixed(precision);
    const priceDiff = measurement.priceDiff.toFixed(precision);
    const pricePercent = measurement.pricePercent.toFixed(2);
    const time1 = formatTime(measurement.point1.time);
    const time2 = formatTime(measurement.point2.time);
    const timeDiff = measurement.timeDiffFormatted;
    
    return `Price: $${price1} → $${price2} (Δ $${priceDiff}, ${pricePercent >= 0 ? '+' : ''}${pricePercent}%) | Time: ${time1} → ${time2} (Δ ${timeDiff})`;
  };

  const clearMeasurement = () => {
    if (measurementLineRef.current && candlestickSeriesRef.current) {
      candlestickSeriesRef.current.removePriceLine(measurementLineRef.current);
      measurementLineRef.current = null;
    }
    if (measurementOverlayRef.current) {
      measurementOverlayRef.current.remove();
      measurementOverlayRef.current = null;
    }
    setMeasurementPoints([]);
    setMeasurementHover(null);
  };

  // Setup drawing and measurement tool event handlers
  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }
    
    const container = chartContainerRef.current;
    
    // Handle measurement tool
    const handleChartClick = (event) => {
      if (!internalMeasurementMode || !chartRef.current) return;
      
      const coords = screenToChartCoords(event.clientX, event.clientY);
      if (!coords) return;
      
      const newPoint = { time: coords.time, price: coords.price, x: coords.x, y: coords.y };
      
      setMeasurementPoints((prev) => {
        if (prev.length === 0) {
          return [newPoint];
        } else if (prev.length === 1) {
          const completedPoints = [prev[0], newPoint];
          setTimeout(() => {
            updateMeasurementOverlay(completedPoints[0], newPoint, false);
          }, 0);
          
          if (onMeasurementComplete) {
            const measurement = calculateMeasurement(completedPoints[0], newPoint);
            onMeasurementComplete(measurement);
          }
          
          return completedPoints;
        } else {
          clearMeasurement();
          return [newPoint];
        }
      });
    };

    const handleChartMouseMove = (event) => {
      if (internalMeasurementMode && chartRef.current) {
        setMeasurementPoints((prev) => {
          if (prev.length !== 1) {
            setMeasurementHover(null);
            return prev;
          }
          
          const coords = screenToChartCoords(event.clientX, event.clientY);
          if (coords) {
            const hoverPoint = { time: coords.time, price: coords.price, x: coords.x, y: coords.y };
            setMeasurementHover(hoverPoint);
            updateMeasurementPreview(prev[0], hoverPoint);
          }
          
          return prev;
        });
      }
      
      // Handle drawing preview
      if (isDrawing) {
        handleDrawingMove(event);
      }
    };

    const handleMouseDown = (event) => {
      if (activeDrawingTool && !drawingsLocked) {
        handleDrawingStart(event);
      }
    };

    const handleMouseUp = (event) => {
      if (isDrawing) {
        handleDrawingEnd(event);
      }
    };

    // Set cursor style based on active tool
    if (internalMeasurementMode || activeDrawingTool) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = 'default';
    }

    // Add event listeners
    container.addEventListener('click', handleChartClick);
    container.addEventListener('mousemove', handleChartMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);

    // Cleanup
    return () => {
      container.removeEventListener('click', handleChartClick);
      container.removeEventListener('mousemove', handleChartMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
    };
  }, [internalMeasurementMode, activeDrawingTool, isDrawing, drawingsLocked, chartRef.current, chartContainerRef.current]);

  // Reset measurement when mode changes
  useEffect(() => {
    if (!internalMeasurementMode) {
      clearMeasurement();
    }
  }, [internalMeasurementMode]);

  // Convert screen coordinates (clientX, clientY) to chart coordinates (time, price)
  const screenToChartCoords = (clientX, clientY) => {
    if (!chartRef.current || !chartContainerRef.current) return null;
    
    try {
      const timeScale = chartRef.current.timeScale();
      const priceScale = chartRef.current.priceScale('right');
      const container = chartContainerRef.current;
      const rect = container.getBoundingClientRect();
      
      // Get relative coordinates within the container
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      
      const visibleRange = timeScale.getVisibleRange();
      const priceRange = priceScale.getVisibleRange();
      
      if (!visibleRange || !priceRange) return null;
      
      const timeRange = visibleRange.to - visibleRange.from;
      const containerWidth = container.clientWidth;
      const timePerPixel = timeRange / containerWidth;
      const time = visibleRange.from + (relativeX * timePerPixel);
      
      const priceDiff = priceRange.to - priceRange.from;
      const containerHeight = container.clientHeight;
      const pricePerPixel = priceDiff / containerHeight;
      // Y increases downward, but price increases upward, so invert
      const price = priceRange.to - (relativeY * pricePerPixel);
      
      return { time, price, x: relativeX, y: relativeY };
    } catch (error) {
      console.warn('[CryptoChart] Error converting screen to chart coordinates:', error);
      return null;
    }
  };

  // Convert chart coordinates (time, price) to screen coordinates
  const chartToScreenCoords = (time, price) => {
    if (!chartRef.current || !chartContainerRef.current) return null;
    
    try {
      const timeScale = chartRef.current.timeScale();
      const priceScale = chartRef.current.priceScale('right');
      const container = chartContainerRef.current;
      
      const visibleRange = timeScale.getVisibleRange();
      const priceRange = priceScale.getVisibleRange();
      
      if (!visibleRange || !priceRange) return null;
      
      const timeRange = visibleRange.to - visibleRange.from;
      const containerWidth = container.clientWidth;
      const timePerPixel = timeRange / containerWidth;
      const relativeX = (time - visibleRange.from) / timePerPixel;
      
      const priceDiff = priceRange.to - priceRange.from;
      const containerHeight = container.clientHeight;
      const pricePerPixel = priceDiff / containerHeight;
      // Y increases downward, but price increases upward, so invert
      const relativeY = (priceRange.to - price) / pricePerPixel;
      
      return { relativeX, relativeY };
    } catch (error) {
      console.warn('[CryptoChart] Error converting chart to screen coordinates:', error);
      return null;
    }
  };

  // Handle drawing start
  const handleDrawingStart = (event) => {
    if (!activeDrawingTool || drawingsLocked) return;
    
    const coords = screenToChartCoords(event.clientX, event.clientY);
    if (!coords) return;
    
    if (activeDrawingTool === 'text') {
      // For text, create input at click position
      const newTextId = `text-${nextDrawingIdRef.current++}`;
      const newText = {
        id: newTextId,
        x: coords.x,
        y: coords.y,
        time: coords.time,
        price: coords.price,
        text: '',
        editing: true,
      };
      setTextInputs((prev) => [...prev, newText]);
      setActiveTextInput(newTextId);
      return;
    }
    
    setIsDrawing(true);
    setDrawingStartPoint(coords);
    setDrawingCurrentPoint(coords);
  };

  // Handle drawing move (for preview)
  const handleDrawingMove = (event) => {
    if (!isDrawing || !drawingStartPoint) return;
    
    const coords = screenToChartCoords(event.clientX, event.clientY);
    if (!coords) return;
    
    setDrawingCurrentPoint(coords);
  };

  // Handle drawing end
  const handleDrawingEnd = (event) => {
    if (!isDrawing || !drawingStartPoint) return;
    
    const coords = screenToChartCoords(event.clientX, event.clientY);
    if (!coords) return;
    
    const newDrawing = {
      id: `drawing-${nextDrawingIdRef.current++}`,
      type: activeDrawingTool,
      startPoint: drawingStartPoint,
      endPoint: coords,
      visible: drawingsVisible,
    };
    
    setDrawings((prev) => [...prev, newDrawing]);
    setIsDrawing(false);
    setDrawingStartPoint(null);
    setDrawingCurrentPoint(null);
    
    // Keep tool active for multiple drawings
    // setActiveDrawingTool(null);
  };

  // Render drawings overlay
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    let overlay = drawingsOverlayRef.current;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '5';
      overlay.className = 'drawings-overlay';
      chartContainerRef.current.appendChild(overlay);
      drawingsOverlayRef.current = overlay;
    }
    
    // Clear overlay
    overlay.innerHTML = '';
    
    if (!drawingsVisible) return;
    
    // Render completed drawings
    drawings.forEach((drawing) => {
      if (!drawing.visible) return;
      
      const startScreen = chartToScreenCoords(drawing.startPoint.time, drawing.startPoint.price);
      const endScreen = chartToScreenCoords(drawing.endPoint.time, drawing.endPoint.price);
      
      if (!startScreen || !endScreen) return;
      
      const element = document.createElement('div');
      element.style.position = 'absolute';
      element.style.pointerEvents = 'none';
      
      if (drawing.type === 'rectangle') {
        const left = Math.min(startScreen.relativeX, endScreen.relativeX);
        const top = Math.min(startScreen.relativeY, endScreen.relativeY);
        const width = Math.abs(endScreen.relativeX - startScreen.relativeX);
        const height = Math.abs(endScreen.relativeY - startScreen.relativeY);
        
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.border = '1px solid #536985';
        element.style.backgroundColor = 'rgba(83, 105, 133, 0.1)';
      } else if (drawing.type === 'line' || drawing.type === 'horizontal-line') {
        const x1 = startScreen.relativeX;
        const y1 = startScreen.relativeY;
        const x2 = endScreen.relativeX;
        const y2 = drawing.type === 'horizontal-line' ? startScreen.relativeY : endScreen.relativeY;
        
        const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        
        element.style.left = `${Math.min(x1, x2)}px`;
        element.style.top = `${Math.min(y1, y2)}px`;
        element.style.width = `${length}px`;
        element.style.height = '2px';
        element.style.backgroundColor = '#536985';
        element.style.transformOrigin = '0 50%';
        element.style.transform = `rotate(${angle}deg)`;
      }
      
      overlay.appendChild(element);
    });
    
    // Render preview drawing
    if (isDrawing && drawingStartPoint && drawingCurrentPoint) {
      const startScreen = chartToScreenCoords(drawingStartPoint.time, drawingStartPoint.price);
      const endScreen = chartToScreenCoords(drawingCurrentPoint.time, drawingCurrentPoint.price);
      
      if (startScreen && endScreen) {
        const previewElement = document.createElement('div');
        previewElement.style.position = 'absolute';
        previewElement.style.pointerEvents = 'none';
        previewElement.style.opacity = '0.7';
        
        if (activeDrawingTool === 'rectangle') {
          const left = Math.min(startScreen.relativeX, endScreen.relativeX);
          const top = Math.min(startScreen.relativeY, endScreen.relativeY);
          const width = Math.abs(endScreen.relativeX - startScreen.relativeX);
          const height = Math.abs(endScreen.relativeY - startScreen.relativeY);
          
          previewElement.style.left = `${left}px`;
          previewElement.style.top = `${top}px`;
          previewElement.style.width = `${width}px`;
          previewElement.style.height = `${height}px`;
          previewElement.style.border = '1px dashed #536985';
          previewElement.style.backgroundColor = 'rgba(83, 105, 133, 0.05)';
        } else if (activeDrawingTool === 'line' || activeDrawingTool === 'horizontal-line') {
          const x1 = startScreen.relativeX;
          const y1 = startScreen.relativeY;
          const x2 = endScreen.relativeX;
          const y2 = activeDrawingTool === 'horizontal-line' ? startScreen.relativeY : endScreen.relativeY;
          
          const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
          const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
          
          previewElement.style.left = `${Math.min(x1, x2)}px`;
          previewElement.style.top = `${Math.min(y1, y2)}px`;
          previewElement.style.width = `${length}px`;
          previewElement.style.height = '2px';
          previewElement.style.backgroundColor = '#536985';
          previewElement.style.transformOrigin = '0 50%';
          previewElement.style.transform = `rotate(${angle}deg)`;
        }
        
        overlay.appendChild(previewElement);
      }
    }
  }, [drawings, isDrawing, drawingStartPoint, drawingCurrentPoint, activeDrawingTool, drawingsVisible]);

  // Render text inputs
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    textInputs.forEach((textInput) => {
      const existingInput = document.getElementById(`text-input-${textInput.id}`);
      if (existingInput) return; // Already rendered
      
      const input = document.createElement('input');
      input.id = `text-input-${textInput.id}`;
      input.type = 'text';
      input.value = textInput.text;
      input.placeholder = 'Enter text...';
      input.style.position = 'absolute';
      input.style.left = `${textInput.x}px`;
      input.style.top = `${textInput.y}px`;
      input.style.zIndex = '20';
      input.style.backgroundColor = '#1a1a1a';
      input.style.border = '1px solid #536985';
      input.style.borderRadius = '4px';
      input.style.padding = '4px 8px';
      input.style.color = '#e0e0e0';
      input.style.fontSize = '12px';
      input.style.fontFamily = 'Inter, sans-serif';
      input.style.minWidth = '100px';
      input.style.pointerEvents = 'auto';
      
      input.addEventListener('blur', () => {
        setTextInputs((prev) =>
          prev.map((t) =>
            t.id === textInput.id
              ? { ...t, text: input.value, editing: false }
              : t
          )
        );
        setActiveTextInput(null);
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
        if (e.key === 'Escape') {
          setTextInputs((prev) => prev.filter((t) => t.id !== textInput.id));
          input.remove();
        }
      });
      
      chartContainerRef.current.appendChild(input);
      if (textInput.editing) {
        setTimeout(() => input.focus(), 0);
      }
    });
  }, [textInputs]);

  // Expose zoom functions - can be called via chartRef or callbacks
  // If callbacks are provided, call them when zoom actions occur
  // Otherwise, zoom functions can be accessed via chartRef.current.timeScale()

  // Update chart data when data prop changes
  useEffect(() => {
    const dataUpdateStartTime = Date.now();
    
    console.log('[CryptoChart] ========================================');
    console.log('[CryptoChart] 📊 Data update triggered:', {
      timestamp: new Date(dataUpdateStartTime).toISOString(),
      isArray: Array.isArray(data),
      length: data?.length,
      dataType: typeof data,
      isNull: data === null,
      isUndefined: data === undefined,
      isInitialized,
      hasChartRef: !!chartRef.current,
      hasCandlestickSeries: !!candlestickSeriesRef.current,
      hasVolumeSeries: !!volumeSeriesRef.current,
    });
    
    // Log exact data structure received
    console.log('[CryptoChart] Data structure details:', {
      firstItem: data?.[0],
      firstItemType: typeof data?.[0],
      dataStructure: data?.[0] ? Object.keys(data[0]) : null,
      firstItemValues: data?.[0] ? {
        time: data[0].time,
        timeType: typeof data[0].time,
        open: data[0].open,
        openType: typeof data[0].open,
        high: data[0].high,
        highType: typeof data[0].high,
        low: data[0].low,
        lowType: typeof data[0].low,
        close: data[0].close,
        closeType: typeof data[0].close,
        volume: data[0].volume,
        volumeType: typeof data[0].volume,
      } : null,
      lastItem: data?.length > 0 ? data[data.length - 1] : null,
      sampleItems: data?.length > 0 ? [
        data[0],
        data[Math.floor(data.length / 2)],
        data[data.length - 1]
      ] : null,
    });

    // Handle empty data gracefully
    if (!data || data.length === 0) {
      console.warn('[CryptoChart] Received empty or null data, clearing chart');
      
      // Mark that we've attempted to load data (even if empty)
      // This prevents showing loading spinner on subsequent empty data
      if (!hasDataLoadedRef.current) {
        hasDataLoadedRef.current = true;
        console.log('[CryptoChart] Marked data as loaded (empty data received)');
      }
      
      // Clear chart series if they exist
      if (candlestickSeriesRef.current) {
        try {
          candlestickSeriesRef.current.setData([]);
          console.log('[CryptoChart] Cleared candlestick series');
        } catch (error) {
          console.error('[CryptoChart] Error clearing candlestick series:', error);
        }
      }
      
      if (volumeSeriesRef.current) {
        try {
          volumeSeriesRef.current.setData([]);
          console.log('[CryptoChart] Cleared volume series');
        } catch (error) {
          console.error('[CryptoChart] Error clearing volume series:', error);
        }
      }
      
      setCurrentPrice(null);
      setPriceChange24h(null);
      return;
    }
    
    // Mark that data has been loaded successfully
    if (!hasDataLoadedRef.current) {
      hasDataLoadedRef.current = true;
      console.log('[CryptoChart] ✅ Data loaded successfully for the first time');
    }

    // Verify data format - check if first item has required fields
    const firstItem = data[0];
    const requiredFields = ['time', 'open', 'high', 'low', 'close', 'volume'];
    const missingFields = requiredFields.filter(field => !(field in firstItem));
    
    if (missingFields.length > 0) {
      console.error('[CryptoChart] Missing required fields:', missingFields);
      console.error('[CryptoChart] First item structure:', firstItem);
      setCurrentPrice(null);
      setPriceChange24h(null);
      return;
    }

    // Validate and transform data to Lightweight Charts format
    // Lightweight Charts expects time in Unix seconds (not milliseconds)
    const candlestickData = [];
    const invalidDataIndices = [];

    data.forEach((d, index) => {
      // Ensure time is in Unix seconds
      let timeInSeconds = d.time;
      
      // Convert to number if it's a string
      if (typeof timeInSeconds === 'string') {
        timeInSeconds = parseFloat(timeInSeconds);
        console.warn(`[CryptoChart] Time at index ${index} was string, converted to number:`, timeInSeconds);
      }
      
      // If time is in milliseconds, convert to seconds
      if (timeInSeconds > 10000000000) {
        timeInSeconds = Math.floor(timeInSeconds / 1000);
        console.log(`[CryptoChart] Time at index ${index} was milliseconds, converted to seconds:`, timeInSeconds);
      }

      // Validate and convert OHLC values to numbers
      const open = typeof d.open === 'string' ? parseFloat(d.open) : Number(d.open);
      const high = typeof d.high === 'string' ? parseFloat(d.high) : Number(d.high);
      const low = typeof d.low === 'string' ? parseFloat(d.low) : Number(d.low);
      const close = typeof d.close === 'string' ? parseFloat(d.close) : Number(d.close);

      // Validate OHLC values are valid numbers
      if (
        isNaN(timeInSeconds) || 
        isNaN(open) || 
        isNaN(high) || 
        isNaN(low) || 
        isNaN(close) ||
        !isFinite(timeInSeconds) ||
        !isFinite(open) ||
        !isFinite(high) ||
        !isFinite(low) ||
        !isFinite(close)
      ) {
        console.error(`[CryptoChart] Invalid data at index ${index}:`, {
          time: timeInSeconds,
          open,
          high,
          low,
          close,
          original: d
        });
        invalidDataIndices.push(index);
        return; // Skip this data point
      }

      // Validate OHLC logic (high >= low, high >= open/close, low <= open/close)
      if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
        console.warn(`[CryptoChart] Invalid OHLC logic at index ${index}:`, {
          open,
          high,
          low,
          close
        });
        // Still add it, but log warning
      }

      candlestickData.push({
        time: timeInSeconds,
        open,
        high,
        low,
        close,
      });
    });

    if (invalidDataIndices.length > 0) {
      console.warn(`[CryptoChart] Skipped ${invalidDataIndices.length} invalid data points at indices:`, invalidDataIndices);
    }

    if (candlestickData.length === 0) {
      console.error('[CryptoChart] No valid data points after validation');
      setCurrentPrice(null);
      setPriceChange24h(null);
      return;
    }

    // Transform volume data with color based on price direction
    const volumeData = [];
    data.forEach((d, index) => {
      // Skip if this index was invalid
      if (invalidDataIndices.includes(index)) {
        return;
      }

      let timeInSeconds = d.time;
      
      // Convert to number if string
      if (typeof timeInSeconds === 'string') {
        timeInSeconds = parseFloat(timeInSeconds);
      }
      
      // Convert milliseconds to seconds
      if (timeInSeconds > 10000000000) {
        timeInSeconds = Math.floor(timeInSeconds / 1000);
      }

      // Convert volume to number
      const volume = typeof d.volume === 'string' ? parseFloat(d.volume) : Number(d.volume || 0);
      
      // Convert OHLC for color determination
      const open = typeof d.open === 'string' ? parseFloat(d.open) : Number(d.open);
      const close = typeof d.close === 'string' ? parseFloat(d.close) : Number(d.close);

      // Determine color based on close vs open
      const isUp = close >= open;
      
      volumeData.push({
        time: timeInSeconds,
        value: isNaN(volume) || !isFinite(volume) ? 0 : volume,
        color: isUp ? '#00c853' : '#ff1744', // Green for up, red for down
      });
    });

    console.log('[CryptoChart] Data transformed:', {
      candlestickDataPoints: candlestickData.length,
      volumeDataPoints: volumeData.length,
      firstCandle: candlestickData[0],
      lastCandle: candlestickData[candlestickData.length - 1],
      timeFormat: 'Unix seconds',
      firstCandleTypes: candlestickData[0] ? {
        time: typeof candlestickData[0].time,
        open: typeof candlestickData[0].open,
        high: typeof candlestickData[0].high,
        low: typeof candlestickData[0].low,
        close: typeof candlestickData[0].close,
      } : null,
    });

    // Check if chart is initialized before updating data
    if (!isInitialized) {
      console.log('[CryptoChart] Chart not yet initialized, skipping data update');
      return;
    }

    // Check if chart and series exist before updating
    if (!chartRef.current) {
      console.warn('[CryptoChart] Chart ref not available, cannot update data');
      return;
    }

    if (!candlestickSeriesRef.current) {
      console.warn('[CryptoChart] Candlestick series not available, cannot update data');
      return;
    }

    if (!volumeSeriesRef.current) {
      console.warn('[CryptoChart] Volume series not available, cannot update data');
      return;
    }
    
    console.log('[CryptoChart] Chart is initialized, proceeding with data update');

    // Update candlestick series with error handling
    const candlestickUpdateStartTime = Date.now();
    console.log('[CryptoChart] Setting data to candlestick series...', {
      dataPoints: candlestickData.length,
      timestamp: new Date(candlestickUpdateStartTime).toISOString(),
    });
    
    try {
      if (!candlestickSeriesRef.current) {
        throw new Error('Candlestick series ref is null');
      }
      
      candlestickSeriesRef.current.setData(candlestickData);
      const candlestickUpdateDuration = Date.now() - candlestickUpdateStartTime;
      
      console.log('[CryptoChart] ✅ Successfully set data to candlestick series:', {
        dataPoints: candlestickData.length,
        firstPoint: candlestickData[0],
        lastPoint: candlestickData[candlestickData.length - 1],
        series: candlestickSeriesRef.current,
        updateDuration: `${candlestickUpdateDuration}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const candlestickUpdateDuration = Date.now() - candlestickUpdateStartTime;
      console.error('[CryptoChart] ❌ Error setting data to candlestick series:', {
        error,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        dataLength: candlestickData.length,
        firstDataPoint: candlestickData[0],
        updateDuration: `${candlestickUpdateDuration}ms`,
        timestamp: new Date().toISOString(),
        seriesRef: candlestickSeriesRef.current,
      });
      setChartError(`Failed to update chart data: ${error.message}`);
    }

    // Update volume series with error handling
    const volumeUpdateStartTime = Date.now();
    console.log('[CryptoChart] Setting data to volume series...', {
      dataPoints: volumeData.length,
      timestamp: new Date(volumeUpdateStartTime).toISOString(),
    });
    
    try {
      if (!volumeSeriesRef.current) {
        console.warn('[CryptoChart] Volume series ref is null, skipping volume data update');
        return;
      }
      
      volumeSeriesRef.current.setData(volumeData);
      const volumeUpdateDuration = Date.now() - volumeUpdateStartTime;
      
      console.log('[CryptoChart] ✅ Successfully set data to volume series:', {
        dataPoints: volumeData.length,
        firstPoint: volumeData[0],
        lastPoint: volumeData[volumeData.length - 1],
        series: volumeSeriesRef.current,
        updateDuration: `${volumeUpdateDuration}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const volumeUpdateDuration = Date.now() - volumeUpdateStartTime;
      console.error('[CryptoChart] ❌ Error setting data to volume series:', {
        error,
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        dataLength: volumeData.length,
        firstDataPoint: volumeData[0],
        seriesRef: volumeSeriesRef.current,
        updateDuration: `${volumeUpdateDuration}ms`,
        timestamp: new Date().toISOString(),
      });
      // Volume series error is not critical, log but don't set chart error
    }
    
    // Log total data update duration
    const totalDataUpdateDuration = Date.now() - dataUpdateStartTime;
    console.log('[CryptoChart] 📊 Data update completed:', {
      totalDuration: `${totalDataUpdateDuration}ms`,
      candlestickDataPoints: candlestickData.length,
      volumeDataPoints: volumeData.length,
      timestamp: new Date().toISOString(),
    });
    
    if (totalDataUpdateDuration > 1000) {
      console.warn('[CryptoChart] ⚠️ Data update took longer than 1 second:', {
        duration: `${totalDataUpdateDuration}ms`,
        threshold: '1000ms',
        warning: 'This may indicate performance issues with large datasets',
      });
    }
    
    console.log('[CryptoChart] ========================================');

    // Set current price and calculate 24h change from first and last candle
    if (data.length > 0) {
      const lastCandle = data[data.length - 1];
      const firstCandle = data[0];
      const currentPriceValue = lastCandle.close;
      setCurrentPrice(currentPriceValue);
      const change = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
      setPriceChange24h(change);

      // Highlight current price with a price line
      // Note: Create price line only once to avoid duplicates
      if (candlestickSeriesRef.current && !priceLineRef.current) {
        try {
          // Create price line for current price
          const priceLine = candlestickSeriesRef.current.createPriceLine({
            price: currentPriceValue,
            color: '#536985',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: 'Current',
          });
          
          priceLineRef.current = priceLine;
        } catch (error) {
          console.warn('[CryptoChart] Could not create price line:', error);
        }
      }
    }
  }, [data, isInitialized]); // Depend on isInitialized to ensure chart is ready
  
  // Note: Chart initialization is independent of data loading
  // Chart will initialize with empty data and update when data arrives

  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  // Loading state - only show spinner if:
  // 1. Chart is not initialized yet, OR
  // 2. Data is loading AND it's the first time (no data has been loaded yet)
  // Once chart is initialized, show chart even if loading is true (will show old/empty data)
  const shouldShowLoading = !isInitialized || (loading && !hasDataLoadedRef.current);
  
  if (shouldShowLoading) {
    return (
      <div className={cn("w-full h-full flex flex-col items-center justify-center bg-surface rounded-xl border border-border p-8", className)}>
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-textSecondary text-sm">
          {!isInitialized ? 'Initializing chart...' : 'Loading chart data...'}
        </p>
        <p className="mt-2 text-textSecondary text-xs">{symbol} • {timeframe}</p>
        {!isInitialized && chartContainerRef.current && (
          <p className="mt-2 text-textSecondary text-xs">
            Container: {chartContainerRef.current.clientWidth}x{chartContainerRef.current.clientHeight}px
          </p>
        )}
      </div>
    );
  }

  // Chart initialization error state
  if (chartError) {
    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-surface rounded-xl border border-danger p-8", className)}>
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <AlertCircle className="h-12 w-12 text-danger" />
          </div>
          <h3 className="text-lg font-semibold text-textPrimary mb-2">Chart Initialization Error</h3>
          <div className="bg-surfaceHover rounded-lg p-4 mb-4">
            <p className="text-danger text-sm font-medium mb-1">Error details:</p>
            <p className="text-textSecondary text-xs break-words">{chartError}</p>
          </div>
          <Button
            variant="danger"
            size="md"
            onClick={() => {
              console.log('[CryptoChart] Retrying chart initialization...');
              setChartError(null);
              setIsInitialized(false);
              hasDataLoadedRef.current = false; // Reset data loaded flag
              // Force re-initialization by clearing refs
              if (chartRef.current) {
                try {
                  chartRef.current.remove();
                } catch (e) {
                  console.error('[CryptoChart] Error removing chart:', e);
                }
                chartRef.current = null;
              }
              candlestickSeriesRef.current = null;
              volumeSeriesRef.current = null;
              setContainerReady(false);
              initializationStartTimeRef.current = null;
              // Force container ready to trigger re-initialization
              setTimeout(() => {
                setContainerReady(true);
              }, 100);
            }}
            className="w-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Data loading error state
  if (error) {
    const handleRetry = () => {
      console.log('[CryptoChart] Retry clicked for:', { symbol, interval: timeframe });
      if (onTimeframeChange) {
        onTimeframeChange(timeframe);
      }
    };

    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-surface rounded-xl border border-danger p-8", className)}>
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <AlertCircle className="h-12 w-12 text-danger" />
          </div>
          <h3 className="text-lg font-semibold text-textPrimary mb-2">Failed to load chart</h3>
          <div className="text-textSecondary text-sm mb-4 space-y-1">
            <p><span className="font-medium">Symbol:</span> {symbol}</p>
            <p><span className="font-medium">Interval:</span> {timeframe}</p>
          </div>
          <div className="bg-surfaceHover rounded-lg p-4 mb-4">
            <p className="text-danger text-sm font-medium mb-1">Error details:</p>
            <p className="text-textSecondary text-xs break-words">{error.message || String(error)}</p>
          </div>
          <Button
            variant="danger"
            size="md"
            onClick={handleRetry}
            className="w-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }


  return (
    <div 
      className={cn("w-full h-full flex bg-surface rounded-xl border border-border overflow-hidden", className)}
      style={{ height: '100%', minHeight: 0 }}
    >
      {/* Left Sidebar - Drawing Tools Toolbar */}
      <ChartToolbar
        onToolSelect={handleToolSelect}
        activeTool={internalMeasurementMode ? 'crosshair' : activeDrawingTool}
        drawingsLocked={drawingsLocked}
        drawingsVisible={drawingsVisible}
        snapToGrid={snapToGrid}
        onToggleLock={() => setDrawingsLocked(!drawingsLocked)}
        onToggleVisibility={() => setDrawingsVisible(!drawingsVisible)}
        onToggleSnapToGrid={() => setSnapToGrid(!snapToGrid)}
        onDeleteDrawings={handleClearDrawings}
        onSettingsClick={() => console.log('Settings clicked')}
        onAlertsClick={() => console.log('Alerts clicked')}
        activeIndicatorsCount={activeIndicators.length}
        onIndicatorsClick={() => setIsIndicatorsModalOpen(true)}
        indicatorsModalOpen={isIndicatorsModalOpen}
        className="flex-shrink-0"
      />

      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col min-w-0 p-4">
        {/* Top Section: Price Info and Timeframe Buttons */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
          {/* Price Info */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-grow">
            <div>
              <h3 className="text-lg font-semibold text-textPrimary">{symbol}</h3>
              {currentPrice && (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-textPrimary">
                    ${currentPrice >= 1000 ? currentPrice.toFixed(2) : 
                      currentPrice >= 10 ? currentPrice.toFixed(4) : 
                      currentPrice >= 1 ? currentPrice.toFixed(4) : 
                      currentPrice >= 0.01 ? currentPrice.toFixed(6) : 
                      currentPrice.toFixed(8)}
                  </span>
                  {priceChange24h !== null && (
                    <span className={cn(
                      "text-sm font-medium",
                      priceChange24h >= 0 ? "text-success" : "text-danger"
                    )}>
                      {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Timeframe buttons */}
          <div className="flex space-x-2 bg-surfaceHover rounded-lg p-1">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  setTimeframe(tf);
                  if (onTimeframeChange) {
                    onTimeframeChange(tf);
                  }
                }}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  timeframe === tf ? 'bg-accent text-white' : 'text-textSecondary hover:bg-surfaceHover/50'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
        {/* Chart Container */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div 
            className="flex-1 min-h-[300px] bg-[#0d1117] rounded-lg border border-border"
            style={{ 
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              minHeight: 0,
              flex: '1 1 0%',
              overflow: 'hidden',
            }}
          >
            <div 
              ref={chartContainerRef}
              className="w-full h-full"
              style={{ 
                position: 'relative',
                backgroundColor: '#0d1117',
                cursor: (internalMeasurementMode || activeDrawingTool) ? 'crosshair' : 'default',
                width: '100%',
                height: '100%',
                minHeight: 0,
                flex: '1 1 0%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
            {/* Show "No data" overlay when data is empty, but keep container rendered for initialization */}
            {(!data || data.length === 0) && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] z-10">
                <div className="text-center">
                  <p className="text-textSecondary text-sm">No chart data available</p>
                  <p className="text-textSecondary text-xs mt-1">{symbol} • {timeframe}</p>
                </div>
              </div>
            )}
            
            {/* Measurement tooltip */}
            {internalMeasurementMode && measurementPoints.length > 0 && (
              <div className="absolute top-2 left-2 bg-surface border border-border rounded-lg p-2 text-xs text-textPrimary z-20">
                <div className="font-semibold mb-1">Measurement Tool Active</div>
                {measurementPoints.length === 1 && (
                  <div className="text-textSecondary">Click second point to measure</div>
                )}
                {measurementPoints.length === 2 && (
                  <div className="text-textSecondary">
                    Click anywhere to start new measurement
                  </div>
                )}
              </div>
            )}
            
            {/* Drawing tool indicator */}
            {activeDrawingTool && !internalMeasurementMode && (
              <div className="absolute top-2 left-2 bg-surface border border-border rounded-lg p-2 text-xs text-textPrimary z-20">
                <div className="font-semibold mb-1">
                  {activeDrawingTool === 'rectangle' && 'Rectangle Tool'}
                  {activeDrawingTool === 'line' && 'Line Tool'}
                  {activeDrawingTool === 'horizontal-line' && 'Horizontal Line Tool'}
                  {activeDrawingTool === 'text' && 'Text Tool'}
                  {activeDrawingTool === 'fibonacci' && 'Fibonacci Tool'}
                </div>
                <div className="text-textSecondary">
                  {activeDrawingTool === 'text' ? 'Click to add text' : 'Click and drag to draw'}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Indicators Modal */}
      <IndicatorsModal
        isOpen={isIndicatorsModalOpen}
        onClose={() => setIsIndicatorsModalOpen(false)}
        activeIndicators={activeIndicators}
        onAddIndicator={handleAddIndicator}
        onRemoveIndicator={handleRemoveIndicator}
      />
    </div>
  );
};
  
export default CryptoChart;
