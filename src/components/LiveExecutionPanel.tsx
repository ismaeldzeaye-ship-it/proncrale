import React, { useState } from 'react';
import { ShieldAlert, KeyRound, PlugZap, Unplug } from 'lucide-react';
import {
  AppSettings,
  ClosedTrade,
  ExecutionMode,
  LiveExecutionGroup,
  LiveOrderLogEntry,
  PaperPosition,
} from '../engine/types';

interface LiveExecutionPanelProps {
  mode: ExecutionMode;
  connected: boolean;
  accountId: string | null;
  currency: string;
  liveBalance: number | null;
  connectionError: string | null;
  autoStopReason: string | null;
  connecting: boolean;
  onConnect: (token: string, appId: string, accountId: string) => Promise<void>;
  onDisconnect: () => void;
  onClearAutoStop: () => void;
  settings: AppSettings;
  liveGroups: LiveExecutionGroup[];
  liveOrderLog: LiveOrderLogEntry[];
  openPositions: PaperPosition[];
  closedTrades: ClosedTrade[];
}

export const LiveExecutionPanel: React.FC<LiveExecutionPanelProps> = ({
  mode,
  connected,
  accountId,
  currency,
  liveBalance,
  connectionError,
  autoStopReason,
  connecting,
  onConnect,
  onDisconnect,
  onClearAutoStop,
  settings,
  liveGroups,
  liveOrderLog,
  openPositions,
  closedTrades,
}) => {
  // Strictly in-memory token; never saved to localStorage or logged
  const [token, setToken] = useState('');
  const [appId, setAppId] = useState('');
  const [preferredAccountId, setPreferredAccountId] = useState('');

  if (mode === 'paper') return null;

  const isReal = mode === 'real';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConnect(token, appId, preferredAccountId);
  };

  // Match each live execution group against its corresponding paper trade
  const findPaperMetrics = (paperTradeId: string, pair: string) => {
    const open = openPositions.find((p) => p.id === paperTradeId);
    if (open) {
      return {
        entry: open.entryPrice,
        pnl: open.realizedPnl + open.unrealizedPnl,
        precision: pair === 'frxEURUSD' ? 5 : 2,
      };
    }
    const closed = closedTrades.find((t) => t.id === paperTradeId);
    if (closed) {
      return {
        entry: closed.entryPrice,
        pnl: closed.pnlUsd,
        precision: pair === 'frxEURUSD' ? 5 : 2,
      };
    }
    return null;
  };

  return (
    <section
      aria-label="Deriv Live Execution Console"
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Deriv Multiplier Execution · {isReal ? 'Real Account Gateway (/ws/real)' : 'Demo Account Gateway (/ws/demo)'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            One-time-token OTP flow · Token held in memory only · 50/25/25 3-contract ladder
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Caps: Max ${settings.maxStakePerTrade} · {settings.maxOpenContracts} contracts · {settings.liveDailyLossCapPct}% loss
          </span>
          {connected && (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {accountId} · {currency} {liveBalance !== null ? liveBalance.toFixed(2) : '—'}
            </span>
          )}
        </div>
      </div>

      {autoStopReason && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>
              <strong>Auto-Stop Engaged:</strong> {autoStopReason}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearAutoStop}
            className="rounded border border-red-400 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
          >
            Reset Auto-Stop
          </button>
        </div>
      )}

      {/* Auth Form */}
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-5">
          <label
            htmlFor="deriv-token-input"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Deriv API / OAuth Token (memory only)
          </label>
          <div className="relative mt-1">
            <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              id="deriv-token-input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token (never saved)"
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label
            htmlFor="deriv-appid-input"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            App ID (PAT only)
          </label>
          <input
            id="deriv-appid-input"
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="deriv-accountid-input"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Account ID (optional)
          </label>
          <input
            id="deriv-accountid-input"
            type="text"
            value={preferredAccountId}
            onChange={(e) => setPreferredAccountId(e.target.value)}
            placeholder={isReal ? 'Auto-detect Real' : 'Auto-detect Demo'}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-end md:col-span-2">
          {connected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </button>
          ) : (
            <button
              type="submit"
              disabled={connecting || !token.trim()}
              className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {connecting ? 'Connecting...' : `Connect ${isReal ? 'Real' : 'Demo'}`}
            </button>
          )}
        </div>
      </form>

      {connectionError && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{connectionError}</p>
      )}

      {/* Side-by-side Paper vs Live Slippage Comparison + Order Log */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Paper vs Live Comparison */}
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Paper vs Live Execution (Slippage Monitor)
          </h3>
          {liveGroups.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              No live multiplier ladders executed yet. Signals passing Quant & Guard will mirror here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">Pair</th>
                    <th className="px-2.5 py-2 font-medium text-right">Paper Entry</th>
                    <th className="px-2.5 py-2 font-medium text-right">Live Entry</th>
                    <th className="px-2.5 py-2 font-medium text-right">Paper PnL</th>
                    <th className="px-2.5 py-2 font-medium text-right">Live PnL</th>
                    <th className="px-2.5 py-2 font-medium text-right">Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                  {liveGroups.map((g) => {
                    const paper = findPaperMetrics(g.paperTradeId, g.pair);
                    const precision = g.pair === 'frxEURUSD' ? 5 : 2;
                    const diff = paper ? g.totalLivePnl - paper.pnl : 0;
                    return (
                      <tr key={g.id}>
                        <td className="px-2.5 py-2 text-slate-900 dark:text-slate-100">
                          {g.pair === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'} · {g.direction}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          {paper ? paper.entry.toFixed(precision) : g.paperExpectedEntry.toFixed(precision)}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          {g.liveActualEntry !== undefined ? g.liveActualEntry.toFixed(precision) : 'Pending'}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          {paper ? `${paper.pnl >= 0 ? '+' : ''}$${paper.pnl.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          {g.totalLivePnl >= 0 ? '+' : ''}${g.totalLivePnl.toFixed(2)}
                        </td>
                        <td
                          className={`px-2.5 py-2 text-right ${
                            diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Order Request & Response Log */}
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Live Order Request & Response Log
          </h3>
          {liveOrderLog.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              OTP handshakes, balance reads, proposals, buys, and contract updates appear here.
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">NY Time</th>
                    <th className="px-2.5 py-2 font-medium">Action</th>
                    <th className="px-2.5 py-2 font-medium">Request / Response</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                  {liveOrderLog.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-500">
                        {entry.timestamp}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2.5 py-1.5 font-semibold ${
                          entry.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {entry.action}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300">
                        <div>{entry.requestSummary}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.responseSummary}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
