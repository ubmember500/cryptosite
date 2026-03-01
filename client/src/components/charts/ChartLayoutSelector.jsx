import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';

const ICON_W = 28;
const ICON_H = 20;
const GAP = 2;
const PAD = 1;

/** Outline-only SVG wrapper for layout icons */
const IconBox = ({ children, className }) => (
  <svg
    width={ICON_W}
    height={ICON_H}
    viewBox={`0 0 ${ICON_W} ${ICON_H}`}
    className={cn('flex-shrink-0', className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
  >
    {children}
  </svg>
);

/** Single square */
const Icon1 = () => <rect x={PAD} y={PAD} width={ICON_W - PAD * 2} height={ICON_H - PAD * 2} rx={1} />;

/** 2: vertical split (2 columns) */
const Icon2Col = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = ICON_H - PAD * 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h} rx={1} />
    </>
  );
};

/** 2: horizontal split (2 rows) */
const Icon2Row = () => {
  const w = ICON_W - PAD * 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD} y={PAD + h + GAP} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: three rows */
const Icon3Row = () => {
  const w = ICON_W - PAD * 2;
  const h = (ICON_H - PAD * 2 - GAP * 2) / 3;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD} y={PAD + h + GAP} width={w} height={h} rx={1} />
      <rect x={PAD} y={PAD + (h + GAP) * 2} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: three columns */
const Icon3Col = () => {
  const w = (ICON_W - PAD * 2 - GAP * 2) / 3;
  const h = ICON_H - PAD * 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD + (w + GAP) * 2} y={PAD} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: L-shape missing bottom-right */
const Icon3L = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h * 2 + GAP} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: L-shape missing top-right */
const Icon3LTop = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h * 2 + GAP} rx={1} />
      <rect x={PAD + w + GAP} y={PAD + h + GAP} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: L-shape missing bottom-left */
const Icon3LBottomLeft = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h * 2 + GAP} rx={1} />
      <rect x={PAD} y={PAD + h + GAP} width={w} height={h} rx={1} />
    </>
  );
};

/** 3: L-shape missing top-left */
const Icon3LTopLeft = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h * 2 + GAP} rx={1} />
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
    </>
  );
};

/** 4: 2x2 grid */
const Icon4Grid = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD} y={PAD + h + GAP} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD + h + GAP} width={w} height={h} rx={1} />
    </>
  );
};

/** 4: four columns */
const Icon4Col = () => {
  const w = (ICON_W - PAD * 2 - GAP * 3) / 4;
  const h = ICON_H - PAD * 2;
  return [0, 1, 2, 3].map((i) => (
    <rect key={i} x={PAD + i * (w + GAP)} y={PAD} width={w} height={h} rx={1} />
  ));
};

/** 4: four rows */
const Icon4Row = () => {
  const w = ICON_W - PAD * 2;
  const h = (ICON_H - PAD * 2 - GAP * 3) / 4;
  return [0, 1, 2, 3].map((i) => (
    <rect key={i} x={PAD} y={PAD + i * (h + GAP)} width={w} height={h} rx={1} />
  ));
};

/** 4: two columns, each two stacked */
const Icon4TwoCol = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD} y={PAD + h + GAP} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={h} rx={1} />
      <rect x={PAD + w + GAP} y={PAD + h + GAP} width={w} height={h} rx={1} />
    </>
  );
};

/** 4: two rows, top row merged (2 cells), bottom row 2 */
const Icon4TopMerged = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const hTop = (ICON_H - PAD * 2 - GAP) * 0.4;
  const hBot = (ICON_H - PAD * 2 - GAP) * 0.6;
  return (
    <>
      <rect x={PAD} y={PAD} width={ICON_W - PAD * 2} height={hTop} rx={1} />
      <rect x={PAD} y={PAD + hTop + GAP} width={w} height={hBot} rx={1} />
      <rect x={PAD + w + GAP} y={PAD + hTop + GAP} width={w} height={hBot} rx={1} />
    </>
  );
};

/** 4: two cols, left merged (left = 1 tall, right = 2 stacked) */
const Icon4LeftMerged = () => {
  const wLeft = (ICON_W - PAD * 2 - GAP) * 0.4;
  const wRight = (ICON_W - PAD * 2 - GAP) * 0.6;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={wLeft} height={ICON_H - PAD * 2} rx={1} />
      <rect x={PAD + wLeft + GAP} y={PAD} width={wRight} height={h} rx={1} />
      <rect x={PAD + wLeft + GAP} y={PAD + h + GAP} width={wRight} height={h} rx={1} />
    </>
  );
};

/** 5: big left, 3 right */
const Icon5LeftBig = () => {
  const wLeft = (ICON_W - PAD * 2 - GAP) * 0.5;
  const wRight = (ICON_W - PAD * 2 - GAP) * 0.5 - GAP * 2;
  const h = (ICON_H - PAD * 2 - GAP * 2) / 3;
  const wR = wRight / 1;
  return (
    <>
      <rect x={PAD} y={PAD} width={wLeft} height={ICON_H - PAD * 2} rx={1} />
      <rect x={PAD + wLeft + GAP} y={PAD} width={wR} height={h} rx={1} />
      <rect x={PAD + wLeft + GAP} y={PAD + h + GAP} width={wR} height={h} rx={1} />
      <rect x={PAD + wLeft + GAP} y={PAD + (h + GAP) * 2} width={wR} height={h} rx={1} />
    </>
  );
};

/** 5: three top, big bottom */
const Icon5Top3 = () => {
  const w = (ICON_W - PAD * 2 - GAP * 2) / 3;
  const hTop = (ICON_H - PAD * 2 - GAP) * 0.35;
  const hBot = (ICON_H - PAD * 2 - GAP) * 0.65;
  return (
    <>
      <rect x={PAD} y={PAD} width={w} height={hTop} rx={1} />
      <rect x={PAD + w + GAP} y={PAD} width={w} height={hTop} rx={1} />
      <rect x={PAD + (w + GAP) * 2} y={PAD} width={w} height={hTop} rx={1} />
      <rect x={PAD} y={PAD + hTop + GAP} width={ICON_W - PAD * 2} height={hBot} rx={1} />
    </>
  );
};

/** 5: 2 top, 3 bottom */
const Icon5_2_3 = () => {
  const w = (ICON_W - PAD * 2 - GAP * 2) / 3;
  const hTop = (ICON_H - PAD * 2 - GAP) * 0.4;
  const hBot = (ICON_H - PAD * 2 - GAP) * 0.6;
  const wTop = (ICON_W - PAD * 2 - GAP) / 2;
  return (
    <>
      <rect x={PAD} y={PAD} width={wTop} height={hTop} rx={1} />
      <rect x={PAD + wTop + GAP} y={PAD} width={wTop} height={hTop} rx={1} />
      <rect x={PAD} y={PAD + hTop + GAP} width={w} height={hBot} rx={1} />
      <rect x={PAD + w + GAP} y={PAD + hTop + GAP} width={w} height={hBot} rx={1} />
      <rect x={PAD + (w + GAP) * 2} y={PAD + hTop + GAP} width={w} height={hBot} rx={1} />
    </>
  );
};

/** Number in square (for 5, 6, 7, 8, 10, 12, 14, 16) - smaller font for two digits so they fit */
const IconNumber = ({ n }) => {
  const twoDigits = n >= 10;
  const fontSize = twoDigits ? 7 : 10;
  return (
    <>
      <rect x={PAD} y={PAD} width={ICON_W - PAD * 2} height={ICON_H - PAD * 2} rx={1} />
      <text
        x={ICON_W / 2}
        y={ICON_H / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        style={{ fontFamily: 'system-ui, sans-serif', fontSize, fontWeight: 'bold' }}
      >
        {n}
      </text>
    </>
  );
};

/** 6: 3x2 grid */
const Icon6_3x2 = () => {
  const w = (ICON_W - PAD * 2 - GAP * 2) / 3;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      {[0, 1, 2].map((col) =>
        [0, 1].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={PAD + col * (w + GAP)}
            y={PAD + row * (h + GAP)}
            width={w}
            height={h}
            rx={1}
          />
        ))
      )}
    </>
  );
};

/** 6: 2x3 grid */
const Icon6_2x3 = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP * 2) / 3;
  return (
    <>
      {[0, 1].map((col) =>
        [0, 1, 2].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={PAD + col * (w + GAP)}
            y={PAD + row * (h + GAP)}
            width={w}
            height={h}
            rx={1}
          />
        ))
      )}
    </>
  );
};

/** 8: 4x2 */
const Icon8_4x2 = () => {
  const w = (ICON_W - PAD * 2 - GAP * 3) / 4;
  const h = (ICON_H - PAD * 2 - GAP) / 2;
  return (
    <>
      {[0, 1, 2, 3].map((col) =>
        [0, 1].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={PAD + col * (w + GAP)}
            y={PAD + row * (h + GAP)}
            width={w}
            height={h}
            rx={1}
          />
        ))
      )}
    </>
  );
};

/** 8: 2x4 */
const Icon8_2x4 = () => {
  const w = (ICON_W - PAD * 2 - GAP) / 2;
  const h = (ICON_H - PAD * 2 - GAP * 3) / 4;
  return (
    <>
      {[0, 1].map((col) =>
        [0, 1, 2, 3].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={PAD + col * (w + GAP)}
            y={PAD + row * (h + GAP)}
            width={w}
            height={h}
            rx={1}
          />
        ))
      )}
    </>
  );
};

/**
 * Layout definitions for grid rendering.
 * id, count, gridClass used by Market.jsx.
 */
export const CHART_LAYOUTS = [
  { id: '1', count: 1, gridClass: 'grid-cols-1 grid-rows-1' },
  { id: '2-h', count: 2, gridClass: 'grid-cols-2 grid-rows-1' },
  { id: '2-v', count: 2, gridClass: 'grid-cols-1 grid-rows-2' },
  { id: '3-1', count: 3, gridClass: 'grid-cols-1 grid-rows-3' },
  { id: '3-2', count: 3, gridClass: 'grid-cols-3 grid-rows-1' },
  { id: '3-3', count: 3, gridClass: 'grid-cols-2 grid-rows-2', spanLastCols: 2 },
  { id: '3-4', count: 3, gridClass: 'grid-cols-2 grid-rows-2', spanLastCols: 2 },
  { id: '3-5', count: 3, gridClass: 'grid-cols-2 grid-rows-2', spanLastCols: 2 },
  { id: '3-6', count: 3, gridClass: 'grid-cols-2 grid-rows-2', spanLastCols: 2 },
  { id: '4', count: 4, gridClass: 'grid-cols-2 grid-rows-2' },
  { id: '4-col', count: 4, gridClass: 'grid-cols-4 grid-rows-1' },
  { id: '4-row', count: 4, gridClass: 'grid-cols-1 grid-rows-4' },
  { id: '4-two-col', count: 4, gridClass: 'grid-cols-2 grid-rows-2' },
  { id: '4-top-merged', count: 4, gridClass: 'grid-cols-2 grid-rows-2' },
  { id: '4-left-merged', count: 4, gridClass: 'grid-cols-2 grid-rows-2' },
  { id: '5-1', count: 5, gridClass: 'grid-cols-3 grid-rows-2', spanLastCols: 2 },
  { id: '5-2', count: 5, gridClass: 'grid-cols-3 grid-rows-2', spanLastCols: 2 },
  { id: '5-3', count: 5, gridClass: 'grid-cols-3 grid-rows-2', spanLastCols: 2 },
  { id: '5-4', count: 5, gridClass: 'grid-cols-3 grid-rows-2', spanLastCols: 2 },
  { id: '6-1', count: 6, gridClass: 'grid-cols-3 grid-rows-2' },
  { id: '6-2', count: 6, gridClass: 'grid-cols-2 grid-rows-3' },
  { id: '6-3', count: 6, gridClass: 'grid-cols-3 grid-rows-2' },
  { id: '7-1', count: 7, gridClass: 'grid-cols-4 grid-rows-2', spanLastCols: 2 },
  { id: '8-1', count: 8, gridClass: 'grid-cols-2 grid-rows-4' },
  { id: '8-2', count: 8, gridClass: 'grid-cols-2 grid-rows-4' },
  { id: '8-3', count: 8, gridClass: 'grid-cols-4 grid-rows-2' },
];

/** Rows for the selector UI: number -> list of { id, Icon } */
const LAYOUT_ROWS = [
  { num: 1, buttons: [{ id: '1', Icon: Icon1 }] },
  { num: 2, buttons: [{ id: '2-h', Icon: Icon2Col }, { id: '2-v', Icon: Icon2Row }] },
  {
    num: 3,
    buttons: [
      { id: '3-1', Icon: Icon3Row },
      { id: '3-2', Icon: Icon3Col },
      { id: '3-3', Icon: Icon3L },
      { id: '3-4', Icon: Icon3LTop },
      { id: '3-5', Icon: Icon3LBottomLeft },
      { id: '3-6', Icon: Icon3LTopLeft },
    ],
  },
  {
    num: 4,
    buttons: [
      { id: '4', Icon: Icon4Grid },
      { id: '4-col', Icon: Icon4Col },
      { id: '4-row', Icon: Icon4Row },
      { id: '4-two-col', Icon: Icon4TwoCol },
      { id: '4-top-merged', Icon: Icon4TopMerged },
      { id: '4-left-merged', Icon: Icon4LeftMerged },
    ],
  },
  {
    num: 5,
    buttons: [
      { id: '5-1', Icon: Icon5LeftBig },
      { id: '5-2', Icon: Icon5Top3 },
      { id: '5-3', Icon: Icon5_2_3 },
      { id: '5-4', Icon: IconNumber, iconProps: { n: 5 } },
    ],
  },
  {
    num: 6,
    buttons: [
      { id: '6-1', Icon: Icon6_3x2 },
      { id: '6-2', Icon: Icon6_2x3 },
      { id: '6-3', Icon: IconNumber, iconProps: { n: 6 } },
    ],
  },
  { num: 7, buttons: [{ id: '7-1', Icon: IconNumber, iconProps: { n: 7 } }] },
  {
    num: 8,
    buttons: [
      { id: '8-1', Icon: Icon8_4x2 },
      { id: '8-2', Icon: Icon8_2x4 },
      { id: '8-3', Icon: IconNumber, iconProps: { n: 8 } },
    ],
  },
];

const ChartLayoutSelector = ({ value, onChange, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const allButtons = LAYOUT_ROWS.flatMap((r) => r.buttons);
  const currentButton = allButtons.find((b) => b.id === value) || allButtons[0];

  const renderIcon = (button) => {
    const { Icon, iconProps = {} } = button;
    return <Icon {...iconProps} />;
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'inline-flex items-center justify-center h-8 min-w-9 px-1.5 rounded-md transition-colors',
          'text-textPrimary hover:bg-surfaceHover',
          'border border-border bg-surface'
        )}
        title="Chart layout"
        aria-label="Chart layout"
        aria-expanded={isOpen}
      >
        <IconBox className="w-6 h-4 text-textPrimary">
          {renderIcon(currentButton)}
        </IconBox>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
          style={{ minWidth: 200, maxHeight: 420 }}
          role="listbox"
        >
          <div className="overflow-y-auto py-2 px-3" style={{ maxHeight: 400 }}>
            {LAYOUT_ROWS.map((row) => (
              <div
                key={row.num}
                className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-b-0"
              >
                <span className="text-base font-bold text-textPrimary w-6 flex-shrink-0">
                  {row.num}
                </span>
                <div className="flex flex-wrap gap-1">
                  {row.buttons.map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => {
                        onChange(btn.id);
                        setIsOpen(false);
                      }}
                      className={cn(
                        'p-1 rounded transition-colors',
                        value === btn.id
                          ? 'bg-accent/25 text-accent'
                          : 'text-textPrimary hover:bg-surfaceHover'
                      )}
                      title={`Layout ${btn.id}`}
                      aria-selected={value === btn.id}
                    >
                      <IconBox className="text-current">
                        {renderIcon(btn)}
                      </IconBox>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartLayoutSelector;
