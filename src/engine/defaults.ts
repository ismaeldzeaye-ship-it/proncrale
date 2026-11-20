import { AppSettings, PersistedState, SymbolAvailability } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  startBalance: 10000,
  riskPct: 1,
  dailyLossCapPct: 3,
  maxTradesPerPairPerDay: 4,
  partial1R: 2,
  partial1Pct: 50,
  partial2R: 4,
  partial2Pct: 25,
  breakEvenEnabled: true,
  sessionStart: '08:00',
  sessionEnd: '17:00',
  killZonesOnly: false,
  allowBuys: true,
  allowSells: true,
  frequency: 'normal',
  activeMode: true,
  pairs: {
    frxEURUSD: {
      enabled: true,
      spread: 0.00008, // 0.8 pip
      minStop: 0.001, // 10 pips
    },
    cryBTCUSD: {
      enabled: true,
      spread: 12, // $12
      minStop: 100, // $100
    },
  },
  // Live Execution hard caps
  maxStakePerTrade: 500,
  maxOpenContracts: 6,
  liveDailyLossCapPct: 3,
  liveMaxTradesPerDay: 6,
};

export const INITIAL_SYMBOL_AVAILABILITY: Record<'frxEURUSD' | 'cryBTCUSD', SymbolAvailability> = {
  frxEURUSD: {
    symbol: 'frxEURUSD',
    displayName: 'EUR/USD',
    discovered: false,
    available: false,
    exchangeIsOpen: true,
    isSuspended: false,
    reason: 'Discovering symbol...',
    pipSize: 0.00001,
    multipliers: [100, 200, 300, 500, 800],
    minStake: 1,
    maxStake: 2000,
  },
  cryBTCUSD: {
    symbol: 'cryBTCUSD',
    displayName: 'BTC/USD',
    discovered: false,
    available: false,
    exchangeIsOpen: true,
    isSuspended: false,
    reason: 'Discovering symbol...',
    pipSize: 0.001,
    multipliers: [100, 200, 300, 500, 800],
    minStake: 1,
    maxStake: 2000,
  },
};

export function createInitialPersistedState(nyDateKey: string): PersistedState {
  return {
    version: 1,
    theme: 'dark',
    selectedPair: 'frxEURUSD',
    settings: DEFAULT_SETTINGS,
    balance: DEFAULT_SETTINGS.startBalance,
    openPositions: [],
    closedTrades: [],
    equityCurve: [],
    decisionLog: [],
    dailyStats: {
      nyDateKey,
      tradesCount: {
        frxEURUSD: 0,
        cryBTCUSD: 0,
      },
      realizedPnlUsd: 0,
      liveTradesCount: 0,
      liveRealizedPnlUsd: 0,
      lastProcessedCandleEpoch: {},
    },
    liveGroups: [],
  };
}
