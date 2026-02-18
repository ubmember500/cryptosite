/**
 * Custom klinecharts overlays: circle, triangle, rangeMeasurement.
 * Must be registered before chart init. Used by KLineChart.
 */
import { registerOverlay } from 'klinecharts';

function distance(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function formatDuration(ms) {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return Math.round(ms / 86400000) + 'd';
}

function formatVolume(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
  return '$' + (v || 0).toFixed(0);
}

/** Circle: first point = center, second point = radius. totalStep 3 = 2 points. */
const circleOverlay = {
  name: 'circle',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return [];
    const [c0, c1] = coordinates;
    const r = Math.max(1, distance(c0, c1));
    return [
      {
        type: 'circle',
        attrs: { x: c0.x, y: c0.y, r },
      },
    ];
  },
};

/** Triangle: 3 points. totalStep 4 = 3 points. */
const triangleOverlay = {
  name: 'triangle',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 3) return [];
    return [
      {
        type: 'polygon',
        attrs: {
          coordinates: [coordinates[0], coordinates[1], coordinates[2]],
        },
      },
    ];
  },
};

// Range measurement style: softer, less aggressive palette with better readability
const RANGE_DARK_RED = 'rgba(29, 78, 216, 0.18)';
const RANGE_CROSSHAIR_PINK = '#94a3b8';
const RANGE_POPUP_RED = 'rgba(17, 24, 39, 0.95)';
const ARROW_SIZE = 6;
const ARROW_EXTEND = 10;

/**
 * Range measurement: two points define a range; show % change, bar count, duration, volume.
 * Style: dark red selection, bright pink crosshair with arrowheads, red rounded tooltip below.
 */
const rangeMeasurementOverlay = {
  name: 'rangeMeasurement',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: {
    line: { style: 'solid', size: 1 },
    polygon: { style: 'stroke', borderSize: 1 },
  },
  createPointFigures: ({ chart, overlay, coordinates }) => {
    if (coordinates.length < 2 || !overlay.points || overlay.points.length < 2) return [];
    const [c0, c1] = coordinates;
    const p0 = overlay.points[0];
    const p1 = overlay.points[1];
    const dataList = chart.getDataList?.() ?? [];
    const i0 = Math.min(p0.dataIndex ?? 0, p1.dataIndex ?? 0);
    const i1 = Math.max(p0.dataIndex ?? 0, p1.dataIndex ?? 0);
    const barCount = Math.max(0, i1 - i0 + 1);
    const price0 = p0.value ?? 0;
    const price1 = p1.value ?? 0;
    const priceChangePercent = price0 !== 0 ? (((price1 - price0) / price0) * 100) : 0;
    const durationMs = Math.abs((p1.timestamp ?? 0) - (p0.timestamp ?? 0));
    let totalVolume = 0;
    for (let i = i0; i <= i1 && i < dataList.length; i++) {
      totalVolume += dataList[i].volume ?? 0;
    }
    const durationStr = formatDuration(durationMs);
    const volumeStr = formatVolume(totalVolume);
    const sign = priceChangePercent >= 0 ? '+' : '';
    const x = Math.min(c0.x, c1.x);
    const y = Math.min(c0.y, c1.y);
    const w = Math.max(Math.abs(c1.x - c0.x), 4);
    const h = Math.max(Math.abs(c1.y - c0.y), 4);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const lineHeight = 16;
    const pad = 10;
    const popupW = 168;
    const popupH = 3 * lineHeight + 2 * pad;
    const popupY = y + h + ARROW_EXTEND + 4;
    const popupX = cx - popupW / 2;
    const horzEnd = x + w + ARROW_EXTEND;
    const vertEnd = y + h + ARROW_EXTEND;
    const figures = [
      { type: 'rect', attrs: { x, y, width: w, height: h }, styles: { style: 'fill', color: RANGE_DARK_RED } },
      { type: 'line', attrs: { coordinates: [{ x, y: cy }, { x: horzEnd, y: cy }] }, styles: { color: RANGE_CROSSHAIR_PINK, size: 1 }, ignoreEvent: true },
      { type: 'line', attrs: { coordinates: [{ x: cx, y }, { x: cx, y: vertEnd }] }, styles: { color: RANGE_CROSSHAIR_PINK, size: 1 }, ignoreEvent: true },
      { type: 'polygon', attrs: { coordinates: [{ x: horzEnd, y: cy }, { x: horzEnd - ARROW_SIZE, y: cy - ARROW_SIZE / 2 }, { x: horzEnd - ARROW_SIZE, y: cy + ARROW_SIZE / 2 }] }, styles: { style: 'fill', color: RANGE_CROSSHAIR_PINK }, ignoreEvent: true },
      { type: 'polygon', attrs: { coordinates: [{ x: cx, y: vertEnd }, { x: cx - ARROW_SIZE / 2, y: vertEnd - ARROW_SIZE }, { x: cx + ARROW_SIZE / 2, y: vertEnd - ARROW_SIZE }] }, styles: { style: 'fill', color: RANGE_CROSSHAIR_PINK }, ignoreEvent: true },
      { type: 'rect', attrs: { x: popupX, y: popupY, width: popupW, height: popupH }, styles: { style: 'fill', color: RANGE_POPUP_RED, borderRadius: 8 }, ignoreEvent: true },
      { type: 'text', attrs: { x: popupX + popupW / 2, y: popupY + pad, text: `${sign}${priceChangePercent.toFixed(2)}%`, align: 'center', baseline: 'top' }, styles: { color: '#f8fafc', size: 13 }, ignoreEvent: true },
      { type: 'text', attrs: { x: popupX + popupW / 2, y: popupY + pad + lineHeight, text: `${barCount} bars, ${durationStr}`, align: 'center', baseline: 'top' }, styles: { color: '#e5e7eb', size: 12 }, ignoreEvent: true },
      { type: 'text', attrs: { x: popupX + popupW / 2, y: popupY + pad + lineHeight * 2, text: `Volume ${volumeStr}`, align: 'center', baseline: 'top' }, styles: { color: '#e5e7eb', size: 12 }, ignoreEvent: true },
    ];
    return figures;
  },
};

let registered = false;

export function registerCustomShapeOverlays() {
  if (registered) return;
  registerOverlay(circleOverlay);
  registerOverlay(triangleOverlay);
  registerOverlay(rangeMeasurementOverlay);
  registered = true;
}
