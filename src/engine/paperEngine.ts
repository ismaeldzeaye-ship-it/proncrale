import {
  AppSettings,
  ClosedTrade,
  DecisionLogEntry,
  Direction,
  PairId,
  PaperPosition,
  StrategySignal,
} from './types';
import { formatNyTime } from './session';

export function getEntryFillPrice(
  direction: Direction,
  livePrice: number,
  spread: number
): number {
  const half = spread / 2;
  return direction === 'BUY' ? livePrice + half : livePrice - half;
}

export function getExitFillPrice(
  direction: Direction,
  livePrice: number,
  spread: number
): number {
  const half = spread / 2;
  return direction === 'BUY' ? livePrice - half : livePrice + half;
}

export function calcDirectionalPnl(
  direction: Direction,
  entryPrice: number,
  exitPrice: number,
  size: number
): number {
  const diff = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return diff * size;
}

export function openPaperPosition(params: {
  signal: StrategySignal;
  livePrice: number;
  balance: number;
  settings: AppSettings;
  epochSeconds: number;
}): { position: PaperPosition; log: DecisionLogEntry } {
  const { signal, livePrice, balance, settings, epochSeconds } = params;
  const pairSettings = settings.pairs[signal.pair];
  const entryPrice = getEntryFillPrice(signal.direction, livePrice, pairSettings.spread);

  // Ensure stop stays on the protective side and respects minimum stop distance
  const rawDist =
    signal.direction === 'BUY'
      ? entryPrice - signal.stopPrice
      : signal.stopPrice - entryPrice;
  const riskDistance = Math.max(rawDist, pairSettings.minStop, signal.stopDistance);
  const stopPrice =
    signal.direction === 'BUY' ? entryPrice - riskDistance : entryPrice + riskDistance;

  const riskAmountUsd = Math.max(1, balance * (settings.riskPct / 100));
  const startingSize = riskAmountUsd / riskDistance;

  const partial1Target =
    signal.direction === 'BUY'
      ? entryPrice + settings.partial1R * riskDistance
      : entryPrice - settings.partial1R * riskDistance;
  const partial2Target =
    signal.direction === 'BUY'
      ? entryPrice + settings.partial2R * riskDistance
      : entryPrice - settings.partial2R * riskDistance;

  const openedAtNy = formatNyTime(epochSeconds);
  const id = `pos-${signal.pair}-${epochSeconds}-${Math.random().toString(36).slice(2, 6)}`;

  const markExit = getExitFillPrice(signal.direction, livePrice, pairSettings.spread);
  const initialUnrealized = calcDirectionalPnl(
    signal.direction,
    entryPrice,
    markExit,
    startingSize
  );

  const position: PaperPosition = {
    id,
    pair: signal.pair,
    direction: signal.direction,
    setupType: signal.setupType,
    openedAtEpoch: epochSeconds,
    openedAtNy,
    entryPrice,
    stopPrice,
    originalStopPrice: stopPrice,
    riskDistance,
    riskAmountUsd,
    startingSize,
    remainingSize: startingSize,
    stage: 0,
    partial1Target,
    partial2Target,
    partial1Done: false,
    partial2Done: false,
    realizedPnl: 0,
    lastMarkPrice: markExit,
    unrealizedPnl: initialUnrealized,
    unrealizedR: riskAmountUsd > 0 ? initialUnrealized / riskAmountUsd : 0,
    signalReason: signal.reason,
  };

  const precision = signal.pair === 'frxEURUSD' ? 5 : 2;
  const log: DecisionLogEntry = {
    id: `log-entry-${id}`,
    timestampEpoch: epochSeconds,
    nyTime: openedAtNy,
    pair: signal.pair,
    type: 'ENTRY',
    agent: 'Executor',
    message: `Opened ${signal.direction} (${signal.setupType === 'SWEEP_DISPLACEMENT' ? 'Sweep' : 'Active VWAP'}) @ ${entryPrice.toFixed(precision)} · SL ${stopPrice.toFixed(precision)} · Risk $${riskAmountUsd.toFixed(2)} (${settings.riskPct}%).`,
  };

  return { position, log };
}

export interface TickProcessingResult {
  openPositions: PaperPosition[];
  newlyClosedTrades: ClosedTrade[];
  logs: DecisionLogEntry[];
  realizedPnlDelta: number;
  partial1TriggeredPositions: PaperPosition[];
}

export function processTickOnPositions(params: {
  positions: PaperPosition[];
  pair: PairId;
  livePrice: number;
  epochSeconds: number;
  settings: AppSettings;
}): TickProcessingResult {
  const { positions, pair, livePrice, epochSeconds, settings } = params;
  const pairSettings = settings.pairs[pair];
  const nextOpen: PaperPosition[] = [];
  const newlyClosedTrades: ClosedTrade[] = [];
  const logs: DecisionLogEntry[] = [];
  const partial1TriggeredPositions: PaperPosition[] = [];
  let realizedPnlDelta = 0;

  const nyTime = formatNyTime(epochSeconds);
  const precision = pair === 'frxEURUSD' ? 5 : 2;

  for (const orig of positions) {
    if (orig.pair !== pair) {
      nextOpen.push(orig);
      continue;
    }

    const pos = { ...orig };
    const exitPrice = getExitFillPrice(pos.direction, livePrice, pairSettings.spread);
    pos.lastMarkPrice = exitPrice;

    const hitStop =
      pos.direction === 'BUY' ? exitPrice <= pos.stopPrice : exitPrice >= pos.stopPrice;

    if (hitStop) {
      const closingPnl = calcDirectionalPnl(
        pos.direction,
        pos.entryPrice,
        exitPrice,
        pos.remainingSize
      );
      const totalPnl = pos.realizedPnl + closingPnl;
      realizedPnlDelta += totalPnl - orig.realizedPnl;

      const reason =
        pos.stage >= 1 && Math.abs(pos.stopPrice - pos.entryPrice) < 1e-9
          ? 'Break-even stop hit'
          : 'Stop-loss hit';

      newlyClosedTrades.push({
        id: pos.id,
        pair: pos.pair,
        direction: pos.direction,
        setupType: pos.setupType,
        openedAtEpoch: pos.openedAtEpoch,
        closedAtEpoch: epochSeconds,
        openedAtNy: pos.openedAtNy,
        closedAtNy: nyTime,
        entryPrice: pos.entryPrice,
        avgExitPrice: exitPrice,
        startingSize: pos.startingSize,
        riskDistance: pos.riskDistance,
        riskAmountUsd: pos.riskAmountUsd,
        pnlUsd: totalPnl,
        rMultiple: pos.riskAmountUsd > 0 ? totalPnl / pos.riskAmountUsd : 0,
        highestStage: pos.stage,
        closeReason: reason,
      });

      logs.push({
        id: `log-close-${pos.id}-${epochSeconds}`,
        timestampEpoch: epochSeconds,
        nyTime,
        pair: pos.pair,
        type: 'CLOSE',
        agent: 'Executor',
        message: `${reason} on ${pos.direction} @ ${exitPrice.toFixed(precision)} · Net PnL ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${(totalPnl / pos.riskAmountUsd).toFixed(2)}R).`,
      });
      continue;
    }

    // Check Partial 1 (Stage 0 -> Stage 1)
    if (!pos.partial1Done) {
      const hitPartial1 =
        pos.direction === 'BUY'
          ? exitPrice >= pos.partial1Target
          : exitPrice <= pos.partial1Target;

      if (hitPartial1) {
        const closeSize = Math.min(
          pos.remainingSize,
          pos.startingSize * (settings.partial1Pct / 100)
        );
        const partialPnl = calcDirectionalPnl(
          pos.direction,
          pos.entryPrice,
          exitPrice,
          closeSize
        );
        pos.realizedPnl += partialPnl;
        realizedPnlDelta += partialPnl;
        pos.remainingSize = Math.max(0, pos.remainingSize - closeSize);
        pos.partial1Done = true;
        pos.stage = 1;

        if (settings.breakEvenEnabled) {
          pos.stopPrice = pos.entryPrice;
        }
        partial1TriggeredPositions.push({ ...pos });

        logs.push({
          id: `log-p1-${pos.id}-${epochSeconds}`,
          timestampEpoch: epochSeconds,
          nyTime,
          pair: pos.pair,
          type: 'CLOSE',
          agent: 'Executor',
          message: `Partial 1 (${settings.partial1Pct}% @ ${settings.partial1R}R) filled @ ${exitPrice.toFixed(precision)} (+$${partialPnl.toFixed(2)})${settings.breakEvenEnabled ? ' · Stop moved to Break-Even' : ''}.`,
        });
      }
    }

    // Check Partial 2 (Stage 1 -> Stage 2)
    if (pos.partial1Done && !pos.partial2Done && pos.remainingSize > 1e-10) {
      const hitPartial2 =
        pos.direction === 'BUY'
          ? exitPrice >= pos.partial2Target
          : exitPrice <= pos.partial2Target;

      if (hitPartial2) {
        const closeSize = Math.min(
          pos.remainingSize,
          pos.startingSize * (settings.partial2Pct / 100)
        );
        const partialPnl = calcDirectionalPnl(
          pos.direction,
          pos.entryPrice,
          exitPrice,
          closeSize
        );
        pos.realizedPnl += partialPnl;
        realizedPnlDelta += partialPnl;
        pos.remainingSize = Math.max(0, pos.remainingSize - closeSize);
        pos.partial2Done = true;
        pos.stage = 2;

        logs.push({
          id: `log-p2-${pos.id}-${epochSeconds}`,
          timestampEpoch: epochSeconds,
          nyTime,
          pair: pos.pair,
          type: 'CLOSE',
          agent: 'Executor',
          message: `Partial 2 (${settings.partial2Pct}% @ ${settings.partial2R}R) filled @ ${exitPrice.toFixed(precision)} (+$${partialPnl.toFixed(2)}) · Runner active.`,
        });
      }
    }

    if (pos.remainingSize <= 1e-10) {
      newlyClosedTrades.push({
        id: pos.id,
        pair: pos.pair,
        direction: pos.direction,
        setupType: pos.setupType,
        openedAtEpoch: pos.openedAtEpoch,
        closedAtEpoch: epochSeconds,
        openedAtNy: pos.openedAtNy,
        closedAtNy: nyTime,
        entryPrice: pos.entryPrice,
        avgExitPrice: exitPrice,
        startingSize: pos.startingSize,
        riskDistance: pos.riskDistance,
        riskAmountUsd: pos.riskAmountUsd,
        pnlUsd: pos.realizedPnl,
        rMultiple: pos.riskAmountUsd > 0 ? pos.realizedPnl / pos.riskAmountUsd : 0,
        highestStage: pos.stage,
        closeReason: 'All targets filled',
      });
      continue;
    }

    const unrealized = calcDirectionalPnl(
      pos.direction,
      pos.entryPrice,
      exitPrice,
      pos.remainingSize
    );
    pos.unrealizedPnl = unrealized;
    pos.unrealizedR =
      pos.riskAmountUsd > 0 ? (pos.realizedPnl + unrealized) / pos.riskAmountUsd : 0;

    nextOpen.push(pos);
  }

  return {
    openPositions: nextOpen,
    newlyClosedTrades,
    logs,
    realizedPnlDelta,
    partial1TriggeredPositions,
  };
}

export function closeAllPositionsManually(params: {
  positions: PaperPosition[];
  latestQuotes: Partial<Record<PairId, number>>;
  epochSeconds: number;
  settings: AppSettings;
  reason: string;
}): {
  closedTrades: ClosedTrade[];
  logs: DecisionLogEntry[];
  realizedPnlDelta: number;
} {
  const { positions, latestQuotes, epochSeconds, settings, reason } = params;
  const closedTrades: ClosedTrade[] = [];
  const logs: DecisionLogEntry[] = [];
  let realizedPnlDelta = 0;
  const nyTime = formatNyTime(epochSeconds);

  for (const pos of positions) {
    const spread = settings.pairs[pos.pair].spread;
    const livePrice = latestQuotes[pos.pair];
    const exitPrice =
      livePrice !== undefined
        ? getExitFillPrice(pos.direction, livePrice, spread)
        : pos.lastMarkPrice;

    const closingPnl = calcDirectionalPnl(
      pos.direction,
      pos.entryPrice,
      exitPrice,
      pos.remainingSize
    );
    const totalPnl = pos.realizedPnl + closingPnl;
    realizedPnlDelta += closingPnl;

    const precision = pos.pair === 'frxEURUSD' ? 5 : 2;
    closedTrades.push({
      id: pos.id,
      pair: pos.pair,
      direction: pos.direction,
      setupType: pos.setupType,
      openedAtEpoch: pos.openedAtEpoch,
      closedAtEpoch: epochSeconds,
      openedAtNy: pos.openedAtNy,
      closedAtNy: nyTime,
      entryPrice: pos.entryPrice,
      avgExitPrice: exitPrice,
      startingSize: pos.startingSize,
      riskDistance: pos.riskDistance,
      riskAmountUsd: pos.riskAmountUsd,
      pnlUsd: totalPnl,
      rMultiple: pos.riskAmountUsd > 0 ? totalPnl / pos.riskAmountUsd : 0,
      highestStage: pos.stage,
      closeReason: reason,
    });

    logs.push({
      id: `log-flatten-${pos.id}-${epochSeconds}`,
      timestampEpoch: epochSeconds,
      nyTime,
      pair: pos.pair,
      type: 'CLOSE',
      agent: 'Executor',
      message: `${reason}: closed ${pos.direction} @ ${exitPrice.toFixed(precision)} · Net PnL ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}.`,
    });
  }

  return { closedTrades, logs, realizedPnlDelta };
}

function escapeCsvField(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportTradesToCsv(closedTrades: ClosedTrade[]): string {
  const headers = [
    'ID',
    'Pair',
    'Direction',
    'Setup',
    'OpenedNY',
    'ClosedNY',
    'EntryPrice',
    'AvgExitPrice',
    'StartingSize',
    'RiskDistance',
    'RiskUSD',
    'PnL_USD',
    'R_Multiple',
    'HighestStage',
    'CloseReason',
  ];
  const rows = closedTrades.map((t) =>
    [
      t.id,
      t.pair,
      t.direction,
      t.setupType,
      t.openedAtNy,
      t.closedAtNy,
      t.entryPrice,
      t.avgExitPrice,
      t.startingSize.toFixed(4),
      t.riskDistance,
      t.riskAmountUsd.toFixed(2),
      t.pnlUsd.toFixed(2),
      t.rMultiple.toFixed(2),
      t.highestStage,
      t.closeReason,
    ]
      .map(escapeCsvField)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
