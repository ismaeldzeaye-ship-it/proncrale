import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { AppSettings, FrequencyMode } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/defaults';

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onResetAccount: () => void;
  onClose: () => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  settings,
  onChange,
  onResetAccount,
  onClose,
}) => {
  if (!open) return null;

  const updateNum = (key: keyof AppSettings, value: string, min = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    onChange({ ...settings, [key]: Math.max(min, n) });
  };

  const updatePair = (
    pair: 'frxEURUSD' | 'cryBTCUSD',
    field: 'enabled' | 'spread' | 'minStop',
    value: boolean | string
  ) => {
    const curr = settings.pairs[pair];
    if (field === 'enabled' && typeof value === 'boolean') {
      onChange({
        ...settings,
        pairs: { ...settings.pairs, [pair]: { ...curr, enabled: value } },
      });
    } else if (typeof value === 'string') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return;
      onChange({
        ...settings,
        pairs: { ...settings.pairs, [pair]: { ...curr, [field]: n } },
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trading Settings"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F172A]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Strategy & Risk Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Saved automatically to browser storage · Applies to next trade
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5 text-xs">
          {/* Risk & Balance */}
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Risk & Account Sizing
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Start Balance ($)</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={settings.startBalance}
                  onChange={(e) => updateNum('startBalance', e.target.value, 100)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Risk per Trade (%)</span>
                <input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={settings.riskPct}
                  onChange={(e) => updateNum('riskPct', e.target.value, 0.1)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Daily Loss Cap (%)</span>
                <input
                  type="number"
                  min={0.5}
                  max={25}
                  step={0.5}
                  value={settings.dailyLossCapPct}
                  onChange={(e) => updateNum('dailyLossCapPct', e.target.value, 0.5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Max Trades / Pair / Day</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={settings.maxTradesPerPairPerDay}
                  onChange={(e) => updateNum('maxTradesPerPairPerDay', e.target.value, 1)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
          </section>

          {/* Partials & Break-even */}
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Position Management (cTrader Ladder)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Partial 1 Target (R)</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={settings.partial1R}
                  onChange={(e) => updateNum('partial1R', e.target.value, 0.5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Partial 1 Close (%)</span>
                <input
                  type="number"
                  min={5}
                  max={90}
                  step={5}
                  value={settings.partial1Pct}
                  onChange={(e) => updateNum('partial1Pct', e.target.value, 5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Partial 2 Target (R)</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={settings.partial2R}
                  onChange={(e) => updateNum('partial2R', e.target.value, 1)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Partial 2 Close (%)</span>
                <input
                  type="number"
                  min={5}
                  max={90}
                  step={5}
                  value={settings.partial2Pct}
                  onChange={(e) => updateNum('partial2Pct', e.target.value, 5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 pt-1">
              <input
                type="checkbox"
                checked={settings.breakEvenEnabled}
                onChange={(e) => onChange({ ...settings, breakEvenEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span className="text-slate-700 dark:text-slate-300">
                Move stop to Break-Even after Partial 1 fills
              </span>
            </label>
          </section>

          {/* Session & Strategy Controls */}
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              NY Session & Strategy Filters
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Session Start (NY)</span>
                <input
                  type="time"
                  value={settings.sessionStart}
                  onChange={(e) => onChange({ ...settings, sessionStart: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Session End (NY)</span>
                <input
                  type="time"
                  value={settings.sessionEnd}
                  onChange={(e) => onChange({ ...settings, sessionEnd: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block col-span-2">
                <span className="text-slate-600 dark:text-slate-400">Frequency Preset</span>
                <select
                  value={settings.frequency}
                  onChange={(e) =>
                    onChange({ ...settings, frequency: e.target.value as FrequencyMode })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="strict">Strict (N=6 candles, k=1.2x ATR)</option>
                  <option value="normal">Normal (N=8 candles, k=0.8x ATR)</option>
                  <option value="loose">Loose (N=12 candles, k=0.4x ATR)</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.activeMode}
                  onChange={(e) => onChange({ ...settings, activeMode: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-slate-700 dark:text-slate-300">Active Mode (VWAP pullback)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.killZonesOnly}
                  onChange={(e) => onChange({ ...settings, killZonesOnly: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-slate-700 dark:text-slate-300">Kill Zones Only</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.allowBuys}
                  onChange={(e) => onChange({ ...settings, allowBuys: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-slate-700 dark:text-slate-300">Allow Buys</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.allowSells}
                  onChange={(e) => onChange({ ...settings, allowSells: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-slate-700 dark:text-slate-300">Allow Sells</span>
              </label>
            </div>
          </section>

          {/* Pairs Config */}
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Pairs, Spreads & Minimum Stops
            </h3>

            <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex cursor-pointer items-center justify-between font-medium text-slate-800 dark:text-slate-200">
                <span>EUR/USD (frxEURUSD)</span>
                <input
                  type="checkbox"
                  checked={settings.pairs.frxEURUSD.enabled}
                  onChange={(e) => updatePair('frxEURUSD', 'enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-slate-500">Spread (price, 0.00008 = 0.8 pip)</span>
                  <input
                    type="number"
                    step="0.00001"
                    value={settings.pairs.frxEURUSD.spread}
                    onChange={(e) => updatePair('frxEURUSD', 'spread', e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-500">Min Stop (price, 0.0010 = 10 pips)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={settings.pairs.frxEURUSD.minStop}
                    onChange={(e) => updatePair('frxEURUSD', 'minStop', e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex cursor-pointer items-center justify-between font-medium text-slate-800 dark:text-slate-200">
                <span>BTC/USD (cryBTCUSD)</span>
                <input
                  type="checkbox"
                  checked={settings.pairs.cryBTCUSD.enabled}
                  onChange={(e) => updatePair('cryBTCUSD', 'enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-slate-500">Spread ($)</span>
                  <input
                    type="number"
                    step="1"
                    value={settings.pairs.cryBTCUSD.spread}
                    onChange={(e) => updatePair('cryBTCUSD', 'spread', e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-500">Min Stop ($)</span>
                  <input
                    type="number"
                    step="10"
                    value={settings.pairs.cryBTCUSD.minStop}
                    onChange={(e) => updatePair('cryBTCUSD', 'minStop', e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Deriv Live Execution Hard Caps */}
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Deriv Live Execution Hard Caps
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Max Stake / Trade ($)</span>
                <input
                  type="number"
                  min={5}
                  step={10}
                  value={settings.maxStakePerTrade}
                  onChange={(e) => updateNum('maxStakePerTrade', e.target.value, 5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Max Open Contracts</span>
                <input
                  type="number"
                  min={3}
                  step={1}
                  value={settings.maxOpenContracts}
                  onChange={(e) => updateNum('maxOpenContracts', e.target.value, 3)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Live Daily Loss Cap (%)</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={settings.liveDailyLossCapPct}
                  onChange={(e) => updateNum('liveDailyLossCapPct', e.target.value, 0.5)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-600 dark:text-slate-400">Max Live Trades / Day</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={settings.liveMaxTradesPerDay}
                  onChange={(e) => updateNum('liveMaxTradesPerDay', e.target.value, 1)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_SETTINGS)}
            className="min-h-[40px] rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Restore Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetAccount}
              className="flex min-h-[40px] items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Paper Journal
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
