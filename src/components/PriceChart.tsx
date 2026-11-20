import React, { useMemo, useState } from 'react';
import {
  Candle,
  FeedStatus,
  FrozenRange,
  PairId,
  PaperPosition,
  SymbolAvailability,
} from '../engine/types';
import { formatNyShortTime, getSessionClockInfo } from '../engine/session';

interface PriceChartProps {
  pair: PairId;
  candles: Candle[];
  vwapSeries: (number | null)[];
  atrSeries: (number | null)[];
  frozenRange: FrozenRange | null;
  openPosition: PaperPosition | null;
  liveQuote: number | null;
  feedStatus: FeedStatus;
  symbolInfo: SymbolAvailability;
  sessionStart: string;
  sessionEnd: string;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  pair,
  candles,
  vwapSeries,
  atrSeries,
  frozenRange,
  openPosition,
  liveQuote,
  feedStatus,
  symbolInfo,
  sessionStart,
  sessionEnd,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const precision = pair === 'frxEURUSD' ? 5 : 2;

  // Show the most recent 96 candles (~8 hours of 5m bars) for crisp legibility
  const windowData = useMemo(() => {
    const sliceCount = 96;
    const startIdx = Math.max(0, candles.length - sliceCount);
    const slice = candles.slice(startIdx);
    const vwaps = vwapSeries.slice(startIdx);
    const atrs = atrSeries.slice(startIdx);
    return { slice, vwaps, atrs };
  }, [candles, vwapSeries, atrSeries]);

  const { slice, vwaps, atrs } = windowData;

  const bounds = useMemo(() => {
    if (slice.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      const v = vwaps[i];
      if (v !== null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (frozenRange) {
      if (frozenRange.high > max) max = frozenRange.high;
      if (frozenRange.low < min) min = frozenRange.low;
    }
    if (openPosition) {
      const levels = [
        openPosition.entryPrice,
        openPosition.stopPrice,
        openPosition.partial1Target,
        openPosition.partial2Target,
      ];
      for (const lv of levels) {
        if (lv < min) min = lv;
        if (lv > max) max = lv;
      }
    }
    if (liveQuote !== null) {
      if (liveQuote < min) min = liveQuote;
      if (liveQuote > max) max = liveQuote;
    }
    const pad = (max - min) * 0.08 || (pair === 'frxEURUSD' ? 0.001 : 50);
    return { min: min - pad, max: max + pad };
  }, [slice, vwaps, frozenRange, openPosition, liveQuote, pair]);

  const width = 920;
  const height = 360;
  const padLeft = 14;
  const padRight = 76;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const priceToY = (price: number): number => {
    const span = bounds.max - bounds.min || 1;
    return padTop + ((bounds.max - price) / span) * plotH;
  };

  const idxToX = (idx: number): number => {
    if (slice.length <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (slice.length - 1)) * plotW;
  };

  const candleWidth = slice.length > 1 ? Math.max(2, Math.min(8, (plotW / slice.length) * 0.62)) : 6;

  // Build VWAP SVG path
  const vwapPath = useMemo(() => {
    let d = '';
    let started = false;
    for (let i = 0; i < slice.length; i++) {
      const v = vwaps[i];
      if (v === null) {
        started = false;
        continue;
      }
      const x = idxToX(i);
      const y = priceToY(v);
      d += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : ` M ${x.toFixed(1)} ${y.toFixed(1)}`;
      started = true;
    }
    return d;
  }, [slice.length, vwaps, bounds]);

  // Grid ticks
  const yTicks = useMemo(() => {
    const count = 5;
    const arr: number[] = [];
    const span = bounds.max - bounds.min;
    for (let i = 0; i <= count; i++) {
      arr.push(bounds.min + (span * i) / count);
    }
    return arr;
  }, [bounds]);

  const activeIdx = hoverIdx !== null && slice[hoverIdx] ? hoverIdx : slice.length - 1;
  const inspectedCandle = slice[activeIdx] || null;
  const inspectedVwap = vwaps[activeIdx] ?? null;
  const inspectedAtr = atrs[activeIdx] ?? null;

  if (symbolInfo.discovered && !symbolInfo.available && slice.length === 0) {
    return (
      <div className="flex h-[360px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-[#111827]">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {symbolInfo.displayName} Unavailable
        </p>
        <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
          {symbolInfo.reason || 'Symbol missing or suspended on Deriv public feed.'}
        </p>
      </div>
    );
  }

  if (slice.length === 0) {
    return (
      <div className="flex h-[360px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-[#111827]">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {feedStatus === 'connected'
            ? `Loading ${symbolInfo.displayName} 5m candles...`
            : `Connecting to Deriv public stream (${feedStatus})...`}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="price-chart"
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Chart Header Readout */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800/80">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {symbolInfo.displayName} · 5m
          </h2>
          {inspectedCandle && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-600 dark:text-slate-300">
              <span>{formatNyShortTime(inspectedCandle.epoch)} NY</span>
              <span>O {inspectedCandle.open.toFixed(precision)}</span>
              <span>H {inspectedCandle.high.toFixed(precision)}</span>
              <span>L {inspectedCandle.low.toFixed(precision)}</span>
              <span>C {inspectedCandle.close.toFixed(precision)}</span>
              <span>Ticks {inspectedCandle.tickCount}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
          <span className="text-amber-600 dark:text-amber-400">
            VWAP {inspectedVwap !== null ? inspectedVwap.toFixed(precision) : '—'}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            ATR(14) {inspectedAtr !== null ? inspectedAtr.toFixed(precision) : '—'}
          </span>
          {frozenRange && (
            <span className="text-sky-600 dark:text-sky-400">
              A+L {frozenRange.low.toFixed(precision)} – {frozenRange.high.toFixed(precision)}
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[300px] w-full select-none sm:h-[340px]"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            const norm = (relX - padLeft) / plotW;
            const idx = Math.round(norm * (slice.length - 1));
            if (idx >= 0 && idx < slice.length) setHoverIdx(idx);
          }}
        >
          {/* Kill Zone vertical background bands */}
          {slice.map((c, idx) => {
            const clk = getSessionClockInfo(c.epoch, sessionStart, sessionEnd);
            if (!clk.activeKillZone) return null;
            const x = idxToX(idx);
            const barStep = slice.length > 1 ? plotW / (slice.length - 1) : 6;
            return (
              <rect
                key={`kz-${c.epoch}`}
                x={x - barStep / 2}
                y={padTop}
                width={barStep + 0.5}
                height={plotH}
                fill="currentColor"
                className="text-blue-500/[0.05] dark:text-blue-400/[0.06]"
              />
            );
          })}

          {/* Horizontal Grid + Y Axis Labels */}
          {yTicks.map((val, i) => {
            const y = priceToY(val);
            return (
              <g key={`grid-${i}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray="2 3"
                  className="text-slate-200 dark:text-slate-800"
                />
                <text
                  x={width - padRight + 6}
                  y={y + 3}
                  className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
                >
                  {val.toFixed(precision)}
                </text>
              </g>
            );
          })}

          {/* Asia + London Frozen Range Band */}
          {frozenRange && (
            <g>
              <line
                x1={padLeft}
                y1={priceToY(frozenRange.high)}
                x2={width - padRight}
                y2={priceToY(frozenRange.high)}
                stroke="#0284c7"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <line
                x1={padLeft}
                y1={priceToY(frozenRange.low)}
                x2={width - padRight}
                y2={priceToY(frozenRange.low)}
                stroke="#0284c7"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            </g>
          )}

          {/* Candlesticks */}
          {slice.map((c, idx) => {
            const x = idxToX(idx);
            const yHigh = priceToY(c.high);
            const yLow = priceToY(c.low);
            const yOpen = priceToY(c.open);
            const yClose = priceToY(c.close);
            const bull = c.close >= c.open;
            const color = bull ? '#16a34a' : '#dc2626';
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
            return (
              <g key={c.epoch}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.1} />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyH}
                  fill={color}
                  rx={0.5}
                />
              </g>
            );
          })}

          {/* Session Anchored VWAP */}
          {vwapPath && (
            <path d={vwapPath} fill="none" stroke="#f59e0b" strokeWidth={1.75} />
          )}

          {/* Open Trade Levels */}
          {openPosition && (
            <g>
              {/* Entry */}
              <line
                x1={padLeft}
                y1={priceToY(openPosition.entryPrice)}
                x2={width - padRight}
                y2={priceToY(openPosition.entryPrice)}
                stroke="#3b82f6"
                strokeWidth={1.2}
              />
              <text
                x={padLeft + 4}
                y={priceToY(openPosition.entryPrice) - 4}
                className="fill-blue-500 font-mono text-[10px] font-semibold"
              >
                ENTRY {openPosition.entryPrice.toFixed(precision)}
              </text>

              {/* Stop Loss */}
              <line
                x1={padLeft}
                y1={priceToY(openPosition.stopPrice)}
                x2={width - padRight}
                y2={priceToY(openPosition.stopPrice)}
                stroke="#ef4444"
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
              <text
                x={padLeft + 4}
                y={priceToY(openPosition.stopPrice) - 4}
                className="fill-red-500 font-mono text-[10px] font-semibold"
              >
                SL {openPosition.stopPrice.toFixed(precision)}
              </text>

              {/* Partial 1 (2R) */}
              {!openPosition.partial1Done && (
                <>
                  <line
                    x1={padLeft}
                    y1={priceToY(openPosition.partial1Target)}
                    x2={width - padRight}
                    y2={priceToY(openPosition.partial1Target)}
                    stroke="#16a34a"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft + 4}
                    y={priceToY(openPosition.partial1Target) - 4}
                    className="fill-emerald-500 font-mono text-[10px]"
                  >
                    TP1 {openPosition.partial1Target.toFixed(precision)}
                  </text>
                </>
              )}

              {/* Partial 2 (4R) */}
              {!openPosition.partial2Done && (
                <>
                  <line
                    x1={padLeft}
                    y1={priceToY(openPosition.partial2Target)}
                    x2={width - padRight}
                    y2={priceToY(openPosition.partial2Target)}
                    stroke="#10b981"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft + 4}
                    y={priceToY(openPosition.partial2Target) - 4}
                    className="fill-emerald-400 font-mono text-[10px]"
                  >
                    TP2 {openPosition.partial2Target.toFixed(precision)}
                  </text>
                </>
              )}
            </g>
          )}

          {/* Live Price Line */}
          {liveQuote !== null && (
            <g>
              <line
                x1={padLeft}
                y1={priceToY(liveQuote)}
                x2={width - padRight}
                y2={priceToY(liveQuote)}
                stroke="#94a3b8"
                strokeWidth={0.9}
                strokeDasharray="2 2"
              />
              <rect
                x={width - padRight + 2}
                y={priceToY(liveQuote) - 8}
                width={70}
                height={16}
                rx={3}
                fill="#1d4ed8"
              />
              <text
                x={width - padRight + 6}
                y={priceToY(liveQuote) + 3}
                className="fill-white font-mono text-[10px] font-semibold"
              >
                {liveQuote.toFixed(precision)}
              </text>
            </g>
          )}

          {/* Hover crosshair */}
          {hoverIdx !== null && slice[hoverIdx] && (
            <line
              x1={idxToX(hoverIdx)}
              y1={padTop}
              x2={idxToX(hoverIdx)}
              y2={height - padBottom}
              stroke="currentColor"
              strokeWidth={0.8}
              className="text-slate-400/50"
            />
          )}

          {/* X-axis NY timestamps */}
          {slice.map((c, idx) => {
            if (idx % 16 !== 0 && idx !== slice.length - 1) return null;
            return (
              <text
                key={`x-${c.epoch}`}
                x={idxToX(idx)}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-400 font-mono text-[10px]"
              >
                {formatNyShortTime(c.epoch)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Amber line: Anchored VWAP (NY session start)</span>
        <span aria-hidden="true">·</span>
        <span>Blue dashed: Asia+London range (00:00–{sessionStart} NY)</span>
        <span aria-hidden="true">·</span>
        <span>Shaded bands: NY Kill Zones (07:00–10:00, 13:30–16:00)</span>
      </div>
    </div>
  );
};
