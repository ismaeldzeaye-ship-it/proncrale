import { DEFAULT_SETTINGS, createInitialPersistedState } from './defaults';
import { PersistedState } from './types';

export const STORAGE_KEY = 'ict_vwap_agents_state_v1';

export function loadPersistedState(currentNyDateKey: string): PersistedState {
  const fallback = createInitialPersistedState(currentNyDateKey);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...(parsed.settings || {}),
      pairs: {
        frxEURUSD: {
          ...DEFAULT_SETTINGS.pairs.frxEURUSD,
          ...(parsed.settings?.pairs?.frxEURUSD || {}),
        },
        cryBTCUSD: {
          ...DEFAULT_SETTINGS.pairs.cryBTCUSD,
          ...(parsed.settings?.pairs?.cryBTCUSD || {}),
        },
      },
    };

    const sameDay = parsed.dailyStats?.nyDateKey === currentNyDateKey;

    return {
      version: 1,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      selectedPair: parsed.selectedPair === 'cryBTCUSD' ? 'cryBTCUSD' : 'frxEURUSD',
      settings: mergedSettings,
      balance:
        typeof parsed.balance === 'number' && Number.isFinite(parsed.balance)
          ? parsed.balance
          : mergedSettings.startBalance,
      openPositions: Array.isArray(parsed.openPositions) ? parsed.openPositions : [],
      closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
      equityCurve: Array.isArray(parsed.equityCurve) ? parsed.equityCurve : [],
      decisionLog: Array.isArray(parsed.decisionLog) ? parsed.decisionLog : [],
      dailyStats: sameDay && parsed.dailyStats
        ? {
            nyDateKey: currentNyDateKey,
            tradesCount: {
              frxEURUSD: parsed.dailyStats.tradesCount?.frxEURUSD ?? 0,
              cryBTCUSD: parsed.dailyStats.tradesCount?.cryBTCUSD ?? 0,
            },
            realizedPnlUsd: parsed.dailyStats.realizedPnlUsd ?? 0,
            liveTradesCount: parsed.dailyStats.liveTradesCount ?? 0,
            liveRealizedPnlUsd: parsed.dailyStats.liveRealizedPnlUsd ?? 0,
            lastProcessedCandleEpoch: parsed.dailyStats.lastProcessedCandleEpoch ?? {},
          }
        : fallback.dailyStats,
      liveGroups: Array.isArray(parsed.liveGroups) ? parsed.liveGroups : [],
    };
  } catch {
    return fallback;
  }
}

export function savePersistedState(state: PersistedState): void {
  try {
    // Only serializable trading state is stored; API tokens and Real confirmation are strictly in-memory
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota issues
  }
}
