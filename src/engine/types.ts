export type PairId = 'frxEURUSD' | 'cryBTCUSD';

export type Direction = 'BUY' | 'SELL';

export type ExecutionMode = 'paper' | 'demo' | 'real';

export type FrequencyMode = 'strict' | 'normal' | 'loose';

export type FeedStatus = 'connecting' | 'connected' | 'reconnecting' | 'down';

export type ThemeMode = 'dark' | 'light';

export interface Candle {
  epoch: number; // bucket start epoch in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  volume?: number;
}

export interface TickData {
  symbol: PairId;
  quote: number;
  bid: number;
  ask: number;
  epoch: number;
  pipSize: number;
}

export interface SymbolAvailability {
  symbol: PairId;
  displayName: string;
  discovered: boolean;
  available: boolean;
  exchangeIsOpen: boolean;
  isSuspended: boolean;
  reason?: string;
  pipSize: number;
  multipliers: number[];
  minStake: number;
  maxStake: number;
}

export interface PairSettings {
  enabled: boolean;
  spread: number; // EURUSD 0.00008 (0.8 pip), BTC $12
  minStop: number; // EURUSD 0.0010 (10 pips), BTC $100
}

export interface AppSettings {
  startBalance: number;
  riskPct: number;
  dailyLossCapPct: number;
  maxTradesPerPairPerDay: number;
  partial1R: number;
  partial1Pct: number;
  partial2R: number;
  partial2Pct: number;
  breakEvenEnabled: boolean;
  sessionStart: string; // "08:00" NY
  sessionEnd: string; // "17:00" NY
  killZonesOnly: boolean;
  allowBuys: boolean;
  allowSells: boolean;
  frequency: FrequencyMode;
  activeMode: boolean;
  pairs: Record<PairId, PairSettings>;
  // Live execution hard caps
  maxStakePerTrade: number;
  maxOpenContracts: number;
  liveDailyLossCapPct: number;
  liveMaxTradesPerDay: number;
}

export interface SessionClockInfo {
  nyDateKey: string; // YYYY-MM-DD in America/New_York
  nyTimeStr: string; // HH:MM:SS
  nyMinutes: number; // minutes since 00:00 NY
  midnightEpoch: number; // UTC epoch seconds for 00:00 NY of nyDateKey
  sessionStartEpoch: number;
  sessionEndEpoch: number;
  inSession: boolean;
  activeKillZone: 'London-NY AM (07:00-10:00)' | 'NY PM (13:30-16:00)' | null;
  sessionStateLabel: 'PRE-SESSION' | 'IN SESSION' | 'POST-SESSION';
}

export interface FrozenRange {
  nyDateKey: string;
  high: number;
  low: number;
  frozen: boolean;
  candleCount: number;
}

export interface SweepSetup {
  id: string;
  direction: Direction;
  sweepExtreme: number;
  sweepCandleEpoch: number;
  candlesRemaining: number;
  totalWindow: number;
  rangeLevelBroken: number;
}

export interface ContinuationSetup {
  id: string;
  direction: Direction;
  crossCandleEpoch: number;
  swingExtreme: number;
  pullbackTouched: boolean;
}

export interface StrategySignal {
  pair: PairId;
  direction: Direction;
  setupType: 'SWEEP_DISPLACEMENT' | 'ACTIVE_VWAP_PULLBACK';
  candleEpoch: number;
  entryReferencePrice: number;
  rawStopPrice: number;
  stopPrice: number;
  stopDistance: number;
  vwapAtSignal: number;
  atrAtSignal: number;
  reason: string;
}

export interface PaperPosition {
  id: string;
  pair: PairId;
  direction: Direction;
  setupType: 'SWEEP_DISPLACEMENT' | 'ACTIVE_VWAP_PULLBACK';
  openedAtEpoch: number;
  openedAtNy: string;
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  riskDistance: number; // R in price units
  riskAmountUsd: number;
  startingSize: number;
  remainingSize: number;
  stage: 0 | 1 | 2;
  partial1Target: number;
  partial2Target: number;
  partial1Done: boolean;
  partial2Done: boolean;
  realizedPnl: number;
  lastMarkPrice: number;
  unrealizedPnl: number;
  unrealizedR: number;
  signalReason: string;
}

export interface ClosedTrade {
  id: string;
  pair: PairId;
  direction: Direction;
  setupType: 'SWEEP_DISPLACEMENT' | 'ACTIVE_VWAP_PULLBACK';
  openedAtEpoch: number;
  closedAtEpoch: number;
  openedAtNy: string;
  closedAtNy: string;
  entryPrice: number;
  avgExitPrice: number;
  startingSize: number;
  riskDistance: number;
  riskAmountUsd: number;
  pnlUsd: number;
  rMultiple: number;
  highestStage: 0 | 1 | 2;
  closeReason: string;
}

export type DecisionType = 'ENTRY' | 'BLOCK' | 'SETUP' | 'CLOSE';

export interface DecisionLogEntry {
  id: string;
  timestampEpoch: number;
  nyTime: string;
  pair: PairId | 'SYSTEM';
  type: DecisionType;
  agent: 'Scout' | 'Cartographer' | 'Judge' | 'Quant' | 'Guard' | 'Executor';
  message: string;
}

export interface AgentStatus {
  name: 'Scout' | 'Cartographer' | 'Judge' | 'Quant' | 'Guard' | 'Executor';
  role: string;
  status: 'nominal' | 'active' | 'warning' | 'blocked';
  headline: string;
  detail: string;
  updatedAt: string;
}

export interface LiveContractLeg {
  contractId: number;
  legLabel: '50% @ 2R' | '25% @ 4R' | '25% Runner';
  stake: number;
  multiplier: number;
  buyPrice: number;
  entrySpot?: number;
  currentSpot?: number;
  profit: number;
  status: 'open' | 'sold' | 'won' | 'lost';
  isSold: boolean;
  takeProfitUsd: number | null;
  stopLossUsd: number;
  breakEvenMoved?: boolean;
}

export interface LiveExecutionGroup {
  id: string;
  paperTradeId: string;
  pair: PairId;
  mode: 'demo' | 'real';
  direction: Direction;
  openedAtEpoch: number;
  paperExpectedEntry: number;
  liveActualEntry?: number;
  legs: LiveContractLeg[];
  totalStake: number;
  totalLivePnl: number;
  status: 'open' | 'closed';
}

export interface LiveOrderLogEntry {
  id: string;
  timestamp: string;
  mode: 'demo' | 'real';
  pair: PairId;
  action: 'OTP' | 'BALANCE' | 'PROPOSAL' | 'BUY' | 'CONTRACT_UPDATE' | 'SELL' | 'KILL_SWITCH' | 'AUTO_STOP';
  requestSummary: string;
  responseSummary: string;
  ok: boolean;
}

export interface DailyPairStats {
  nyDateKey: string;
  tradesCount: Record<PairId, number>;
  realizedPnlUsd: number;
  liveTradesCount: number;
  liveRealizedPnlUsd: number;
  lastProcessedCandleEpoch: Partial<Record<PairId, number>>;
}

export interface EquityPoint {
  epoch: number;
  nyTime: string;
  equity: number;
  balance: number;
}

export interface PersistedState {
  version: number;
  theme: ThemeMode;
  selectedPair: PairId;
  settings: AppSettings;
  balance: number;
  openPositions: PaperPosition[];
  closedTrades: ClosedTrade[];
  equityCurve: EquityPoint[];
  decisionLog: DecisionLogEntry[];
  dailyStats: DailyPairStats;
  liveGroups: LiveExecutionGroup[];
}
