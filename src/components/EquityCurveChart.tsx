import React from 'react';
import { EquityPoint } from '../engine/types';

interface EquityCurveChartProps {
  points: EquityPoint[];
  startBalance: number;
  currentEquity: number;
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  points,
  startBalance,
  currentEquity,
}) => {
  const series: EquityPoint[] =
    points.length > 0
      ? points
      : [
          {
            epoch: Math.floor(Date.now() / 1000),
            nyTime: 'Start',
            equity: startBalance,
            balance: startBalance,
          },
          {
            epoch: Math.floor(Date.now() / 1000),
            nyTime: 'Now',
            equity: currentEquity,
            balance: currentEquity,
          },
        ];

  const values = series.map((p) => p.equity);
  const minVal = Math.min(startBalance, ...values);
  const maxVal = Math.max(startBalance, ...values);
  const span = maxVal - minVal || Math.max(10, startBalance * 0.01);
  const lo = minVal - span * 0.15;
  const hi = maxVal + span * 0.15;

  const width = 420;
  const height = 160;
  const padX = 12;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const toX = (i: number) =>
    series.length <= 1 ? padX + plotW / 2 : padX + (i / (series.length - 1)) * plotW;
  const toY = (v: number) => padY + ((hi - v) / (hi - lo)) * plotH;

  const linePath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.equity).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${toX(series.length - 1).toFixed(1)} ${(height - padY).toFixed(1)} L ${toX(0).toFixed(1)} ${(height - padY).toFixed(1)} Z`;

  const netUsd = currentEquity - startBalance;
  const netPct = startBalance > 0 ? (netUsd / startBalance) * 100 : 0;
  const isPositive = netUsd >= 0;
  const strokeColor = isPositive ? '#16a34a' : '#dc2626';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Equity Curve
        </h3>
        <span
          className={`font-mono text-xs font-medium ${
            isPositive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {netUsd >= 0 ? '+' : ''}${netUsd.toFixed(2)} ({netPct >= 0 ? '+' : ''}
          {netPct.toFixed(2)}%)
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full">
        {/* Start balance baseline */}
        <line
          x1={padX}
          y1={toY(startBalance)}
          x2={width - padX}
          y2={toY(startBalance)}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-slate-300 dark:text-slate-700"
        />
        <path d={areaPath} fill={strokeColor} fillOpacity={0.1} />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={2} />
      </svg>

      <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400">
        <span>Start ${startBalance.toFixed(0)}</span>
        <span>Peak ${maxVal.toFixed(2)}</span>
        <span>Current ${currentEquity.toFixed(2)}</span>
      </div>
    </div>
  );
};
