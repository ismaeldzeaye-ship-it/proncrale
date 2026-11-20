import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  ClosedTrade,
  DecisionLogEntry,
  DecisionType,
  PaperPosition,
} from '../engine/types';

interface PositionsAndLogsProps {
  openPositions: PaperPosition[];
  closedTrades: ClosedTrade[];
  decisionLog: DecisionLogEntry[];
  onExportCsv: () => void;
  onManualClosePosition: (id: string) => void;
}

const DECISION_COLORS: Record<DecisionType, string> = {
  ENTRY: 'text-blue-600 dark:text-blue-400',
  BLOCK: 'text-red-600 dark:text-red-400',
  SETUP: 'text-amber-600 dark:text-amber-400',
  CLOSE: 'text-emerald-600 dark:text-emerald-400',
};

export const PositionsAndLogs: React.FC<PositionsAndLogsProps> = ({
  openPositions,
  closedTrades,
  decisionLog,
  onExportCsv,
  onManualClosePosition,
}) => {
  const [activeTab, setActiveTab] = useState<'decisions' | 'closed'>('decisions');
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | DecisionType>('ALL');

  const filteredDecisions = useMemo(() => {
    if (decisionFilter === 'ALL') return decisionLog;
    return decisionLog.filter((d) => d.type === decisionFilter);
  }, [decisionLog, decisionFilter]);

  return (
    <div className="space-y-4">
      {/* Open Paper Positions */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Open Positions ({openPositions.length})
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Stage 0: Initial · Stage 1: 50% @ 2R (BE) · Stage 2: 25% @ 4R + 25% Runner
          </span>
        </div>

        {openPositions.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No open positions. Entries open automatically inside the NY session when Scout, Cartographer, Judge, Quant, and Guard align.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Pair / Dir</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 font-medium text-right">Entry</th>
                  <th className="py-2 pr-3 font-medium text-right">Stop</th>
                  <th className="py-2 pr-3 font-medium text-right">Mark</th>
                  <th className="py-2 pr-3 font-medium text-right">Rem. Size</th>
                  <th className="py-2 pr-3 font-medium text-right">Unrealized R</th>
                  <th className="py-2 pr-3 font-medium text-right">Net PnL</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                {openPositions.map((pos) => {
                  const precision = pos.pair === 'frxEURUSD' ? 5 : 2;
                  const netPnl = pos.realizedPnl + pos.unrealizedPnl;
                  return (
                    <tr key={pos.id}>
                      <td className="py-2.5 pr-3 font-sans">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {pos.pair === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'}{' '}
                          <span
                            className={
                              pos.direction === 'BUY'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }
                          >
                            {pos.direction}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {pos.setupType === 'SWEEP_DISPLACEMENT' ? 'Sweep' : 'Active VWAP'} · {pos.openedAtNy}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300">
                        Stage {pos.stage}
                      </td>
                      <td className="py-2.5 pr-3 text-right">{pos.entryPrice.toFixed(precision)}</td>
                      <td className="py-2.5 pr-3 text-right">{pos.stopPrice.toFixed(precision)}</td>
                      <td className="py-2.5 pr-3 text-right">{pos.lastMarkPrice.toFixed(precision)}</td>
                      <td className="py-2.5 pr-3 text-right">{pos.remainingSize.toFixed(2)}</td>
                      <td
                        className={`py-2.5 pr-3 text-right font-semibold ${
                          pos.unrealizedR >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {pos.unrealizedR >= 0 ? '+' : ''}
                        {pos.unrealizedR.toFixed(2)}R
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-semibold ${
                          netPnl >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onManualClosePosition(pos.id)}
                          className="rounded border border-slate-300 px-2 py-1 font-sans text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Decision Log & Closed Trade Journal */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setActiveTab('decisions')}
              className={`min-h-[34px] rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'decisions'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Decision Log ({decisionLog.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('closed')}
              className={`min-h-[34px] rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'closed'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Closed Trades ({closedTrades.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'decisions' && (
              <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-900">
                {(['ALL', 'ENTRY', 'BLOCK', 'SETUP', 'CLOSE'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDecisionFilter(f)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      decisionFilter === f
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onExportCsv}
              className="flex min-h-[36px] items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {activeTab === 'decisions' ? (
          filteredDecisions.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No decision log entries yet for the current filter.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">NY Time</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Pair</th>
                    <th className="py-2 pr-3 font-medium">Agent</th>
                    <th className="py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredDecisions.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap py-2 pr-3 font-mono text-slate-500">
                        {d.nyTime}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-3 font-mono font-semibold ${DECISION_COLORS[d.type]}`}>
                        {d.type}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 font-mono text-slate-700 dark:text-slate-300">
                        {d.pair === 'frxEURUSD' ? 'EUR/USD' : d.pair === 'cryBTCUSD' ? 'BTC/USD' : 'SYSTEM'}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 font-medium text-slate-700 dark:text-slate-300">
                        {d.agent}
                      </td>
                      <td className="py-2 text-slate-600 dark:text-slate-300">{d.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : closedTrades.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No closed trades recorded yet.
          </p>
        ) : (
          <div className="max-h-72 overflow-x-auto overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Closed NY</th>
                  <th className="py-2 pr-3 font-medium">Pair</th>
                  <th className="py-2 pr-3 font-medium">Dir</th>
                  <th className="py-2 pr-3 font-medium text-right">Entry</th>
                  <th className="py-2 pr-3 font-medium text-right">Exit</th>
                  <th className="py-2 pr-3 font-medium text-right">R</th>
                  <th className="py-2 pr-3 font-medium text-right">PnL</th>
                  <th className="py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                {closedTrades.map((t) => {
                  const precision = t.pair === 'frxEURUSD' ? 5 : 2;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{t.closedAtNy}</td>
                      <td className="whitespace-nowrap py-2 pr-3 font-sans font-medium">
                        {t.pair === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'}
                      </td>
                      <td
                        className={`whitespace-nowrap py-2 pr-3 font-semibold ${
                          t.direction === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {t.direction}
                      </td>
                      <td className="py-2 pr-3 text-right">{t.entryPrice.toFixed(precision)}</td>
                      <td className="py-2 pr-3 text-right">{t.avgExitPrice.toFixed(precision)}</td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${
                          t.rMultiple >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {t.rMultiple >= 0 ? '+' : ''}
                        {t.rMultiple.toFixed(2)}R
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${
                          t.pnlUsd >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(2)}
                      </td>
                      <td className="py-2 font-sans text-slate-500 dark:text-slate-400">
                        {t.closeReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
