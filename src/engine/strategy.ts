import {
  AppSettings,
  Candle,
  ContinuationSetup,
  DecisionLogEntry,
  Direction,
  FeedStatus,
  FrequencyMode,
  FrozenRange,
  PairId,
  PaperPosition,
  SessionClockInfo,
  StrategySignal,
  SweepSetup,
  SymbolAvailability,
} from './types';
import { formatNyTime } from './session';

export const FREQUENCY_PARAMS: Record<
  FrequencyMode,
  { sweepWindow: number; displacementMultiplier: number }
> = {
  strict: { sweepWindow: 6, displacementMultiplier: 1.2 },
  normal: { sweepWindow: 8, displacementMultiplier: 0.8 },
  loose: { sweepWindow: 12, displacementMultiplier: 0.4 },
};

export interface StrategyEvaluationInput {
  pair: PairId;
  candle: Candle;
  prevCandle: Candle | null;
  atr: number | null;
  vwap: number | null;
  prevVwap: number | null;
  frozenRange: FrozenRange | null;
  activeSweep: SweepSetup | null;
  activeContinuation: ContinuationSetup | null;
  settings: AppSettings;
  clock: SessionClockInfo;
  balance: number;
  dailyRealizedPnlUsd: number;
  pairTradesToday: number;
  openPositions: PaperPosition[];
  feedStatus: FeedStatus;
  symbolAvailability: SymbolAvailability;
  killSwitchEngaged: boolean;
  liveAutoStopReason: string | null;
  executionMode: 'paper' | 'demo' | 'real';
}

export interface GuardCheckResult {
  allowed: boolean;
  reason: string;
}

export interface QuantCheckResult {
  allowed: boolean;
  spreadCostR: number;
  reason: string;
}

export interface StrategyEvaluationOutput {
  nextSweep: SweepSetup | null;
  nextContinuation: ContinuationSetup | null;
  signal: StrategySignal | null;
  guardCheck: GuardCheckResult;
  quantCheck: QuantCheckResult | null;
  logs: DecisionLogEntry[];
}

export function checkQuantSpread(
  spread: number,
  stopDistance: number
): QuantCheckResult {
  if (stopDistance <= 0) {
    return {
      allowed: false,
      spreadCostR: Infinity,
      reason: 'Stop distance must be positive.',
    };
  }
  const spreadCostR = spread / stopDistance;
  if (spreadCostR > 0.2) {
    return {
      allowed: false,
      spreadCostR,
      reason: `Spread cost ${spreadCostR.toFixed(2)}R exceeds 0.20R limit.`,
    };
  }
  return {
    allowed: true,
    spreadCostR,
    reason: `Spread cost ${spreadCostR.toFixed(2)}R within 0.20R cap.`,
  };
}

export function checkGuardRules(params: {
  pair: PairId;
  direction: Direction;
  settings: AppSettings;
  clock: SessionClockInfo;
  balance: number;
  dailyRealizedPnlUsd: number;
  pairTradesToday: number;
  openPositions: PaperPosition[];
  feedStatus: FeedStatus;
  symbolAvailability: SymbolAvailability;
  killSwitchEngaged: boolean;
  liveAutoStopReason: string | null;
  executionMode: 'paper' | 'demo' | 'real';
}): GuardCheckResult {
  const {
    pair,
    direction,
    settings,
    clock,
    balance,
    dailyRealizedPnlUsd,
    pairTradesToday,
    openPositions,
    feedStatus,
    symbolAvailability,
    killSwitchEngaged,
    liveAutoStopReason,
    executionMode,
  } = params;

  if (killSwitchEngaged) {
    return { allowed: false, reason: 'Kill switch is engaged.' };
  }
  if (executionMode !== 'paper' && liveAutoStopReason) {
    return { allowed: false, reason: `Live auto-stop active: ${liveAutoStopReason}` };
  }
  if (feedStatus !== 'connected') {
    return { allowed: false, reason: `Feed status is ${feedStatus}; entries paused.` };
  }
  if (!symbolAvailability.available) {
    return {
      allowed: false,
      reason: symbolAvailability.reason || `${pair} is unavailable on Deriv.`,
    };
  }
  if (!settings.pairs[pair].enabled) {
    return { allowed: false, reason: `${pair} is disabled in settings.` };
  }
  if (!clock.inSession) {
    return {
      allowed: false,
      reason: `Outside NY trade window (${settings.sessionStart}-${settings.sessionEnd}).`,
    };
  }
  if (settings.killZonesOnly && !clock.activeKillZone) {
    return {
      allowed: false,
      reason: 'Kill-zones-only enabled; outside 07:00-10:00 and 13:30-16:00 NY.',
    };
  }
  if (direction === 'BUY' && !settings.allowBuys) {
    return { allowed: false, reason: 'Long entries disabled in settings.' };
  }
  if (direction === 'SELL' && !settings.allowSells) {
    return { allowed: false, reason: 'Short entries disabled in settings.' };
  }
  const lossLimit = -(balance * (settings.dailyLossCapPct / 100));
  if (dailyRealizedPnlUsd <= lossLimit) {
    return {
      allowed: false,
      reason: `Daily loss cap (${settings.dailyLossCapPct}%) reached.`,
    };
  }
  if (pairTradesToday >= settings.maxTradesPerPairPerDay) {
    return {
      allowed: false,
      reason: `Max ${settings.maxTradesPerPairPerDay} trades/day reached for ${pair}.`,
    };
  }
  if (openPositions.some((p) => p.pair === pair)) {
    return { allowed: false, reason: `Open position already active on ${pair}.` };
  }

  return { allowed: true, reason: 'All Guard rules passed.' };
}

export function evaluateClosedCandleStrategy(
  input: StrategyEvaluationInput
): StrategyEvaluationOutput {
  const {
    pair,
    candle,
    prevCandle,
    atr,
    vwap,
    prevVwap,
    frozenRange,
    activeSweep,
    activeContinuation,
    settings,
    clock,
  } = input;

  const logs: DecisionLogEntry[] = [];
  const nyTime = formatNyTime(candle.epoch);
  const { sweepWindow, displacementMultiplier } = FREQUENCY_PARAMS[settings.frequency];
  const pairSettings = settings.pairs[pair];

  const makeLog = (
    type: DecisionLogEntry['type'],
    agent: DecisionLogEntry['agent'],
    message: string
  ): DecisionLogEntry => ({
    id: `${pair}-${candle.epoch}-${agent}-${type}-${Math.random().toString(36).slice(2, 7)}`,
    timestampEpoch: candle.epoch,
    nyTime,
    pair,
    type,
    agent,
    message,
  });

  // Only evaluate strategy state inside the active NY trade window
  if (!clock.inSession) {
    return {
      nextSweep: null,
      nextContinuation: null,
      signal: null,
      guardCheck: {
        allowed: false,
        reason: `Outside NY trade window (${settings.sessionStart}-${settings.sessionEnd}).`,
      },
      quantCheck: null,
      logs,
    };
  }

  let currentSweep = activeSweep ? { ...activeSweep } : null;
  let currentContinuation = activeContinuation ? { ...activeContinuation } : null;
  let candidateSignal: StrategySignal | null = null;

  // 1. Check active sweep expiration / displacement entry first (on subsequent candles after sweep)
  if (currentSweep) {
    const body = Math.abs(candle.close - candle.open);
    const isBull = candle.close > candle.open;
    const isBear = candle.close < candle.open;
    const hasIndicators = atr !== null && atr > 0 && vwap !== null;

    const directionMatches =
      (currentSweep.direction === 'BUY' && isBull) ||
      (currentSweep.direction === 'SELL' && isBear);

    const isDisplacement = hasIndicators && body >= displacementMultiplier * atr!;
    const vwapSideValid =
      hasIndicators &&
      ((currentSweep.direction === 'BUY' && candle.close > vwap!) ||
        (currentSweep.direction === 'SELL' && candle.close < vwap!));

    if (directionMatches && isDisplacement && vwapSideValid) {
      const rawStop =
        currentSweep.direction === 'BUY'
          ? currentSweep.sweepExtreme - 0.25 * atr!
          : currentSweep.sweepExtreme + 0.25 * atr!;
      const rawDist = Math.abs(candle.close - rawStop);
      const stopDistance = Math.max(rawDist, pairSettings.minStop);
      const stopPrice =
        currentSweep.direction === 'BUY'
          ? candle.close - stopDistance
          : candle.close + stopDistance;

      candidateSignal = {
        pair,
        direction: currentSweep.direction,
        setupType: 'SWEEP_DISPLACEMENT',
        candleEpoch: candle.epoch,
        entryReferencePrice: candle.close,
        rawStopPrice: rawStop,
        stopPrice,
        stopDistance,
        vwapAtSignal: vwap!,
        atrAtSignal: atr!,
        reason: `Sweep of ${currentSweep.rangeLevelBroken.toFixed(pair === 'frxEURUSD' ? 5 : 2)} followed by ${displacementMultiplier}x ATR displacement across VWAP.`,
      };
      currentSweep = null;
    } else {
      currentSweep.candlesRemaining -= 1;
      if (currentSweep.candlesRemaining <= 0) {
        logs.push(
          makeLog(
            'SETUP',
            'Judge',
            `${currentSweep.direction} sweep setup expired after ${currentSweep.totalWindow} candles without displacement.`
          )
        );
        currentSweep = null;
      }
    }
  }

  // 2. Detect new liquidity sweep against frozen Asia+London range
  if (frozenRange && frozenRange.frozen) {
    const sweptHigh = candle.high > frozenRange.high && candle.close <= frozenRange.high;
    const sweptLow = candle.low < frozenRange.low && candle.close >= frozenRange.low;

    if (sweptHigh && !sweptLow) {
      currentSweep = {
        id: `sweep-${pair}-${candle.epoch}`,
        direction: 'SELL',
        sweepExtreme: candle.high,
        sweepCandleEpoch: candle.epoch,
        candlesRemaining: sweepWindow,
        totalWindow: sweepWindow,
        rangeLevelBroken: frozenRange.high,
      };
      logs.push(
        makeLog(
          'SETUP',
          'Cartographer',
          `Bearish sweep above Asia+London high (${frozenRange.high.toFixed(pair === 'frxEURUSD' ? 5 : 2)}), closed back inside. Window: ${sweepWindow} bars.`
        )
      );
    } else if (sweptLow && !sweptHigh) {
      currentSweep = {
        id: `sweep-${pair}-${candle.epoch}`,
        direction: 'BUY',
        sweepExtreme: candle.low,
        sweepCandleEpoch: candle.epoch,
        candlesRemaining: sweepWindow,
        totalWindow: sweepWindow,
        rangeLevelBroken: frozenRange.low,
      };
      logs.push(
        makeLog(
          'SETUP',
          'Cartographer',
          `Bullish sweep below Asia+London low (${frozenRange.low.toFixed(pair === 'frxEURUSD' ? 5 : 2)}), closed back inside. Window: ${sweepWindow} bars.`
        )
      );
    }
  }

  // 3. Active Mode: VWAP continuation on first pullback after displacement close across VWAP
  if (settings.activeMode && atr !== null && atr > 0 && vwap !== null) {
    const body = Math.abs(candle.close - candle.open);
    const isDisplacement = body >= displacementMultiplier * atr;

    // First check if an existing continuation setup gets its pullback trigger
    if (currentContinuation && !candidateSignal) {
      if (currentContinuation.direction === 'BUY') {
        currentContinuation.swingExtreme = Math.min(currentContinuation.swingExtreme, candle.low);
        const touchedVwap = candle.low <= vwap;
        const closedBullAbove = candle.close > vwap && candle.close > candle.open;
        if (touchedVwap && closedBullAbove) {
          const rawStop = currentContinuation.swingExtreme - 0.25 * atr;
          const rawDist = Math.abs(candle.close - rawStop);
          const stopDistance = Math.max(rawDist, pairSettings.minStop);
          const stopPrice = candle.close - stopDistance;

          candidateSignal = {
            pair,
            direction: 'BUY',
            setupType: 'ACTIVE_VWAP_PULLBACK',
            candleEpoch: candle.epoch,
            entryReferencePrice: candle.close,
            rawStopPrice: rawStop,
            stopPrice,
            stopDistance,
            vwapAtSignal: vwap,
            atrAtSignal: atr,
            reason: 'Active mode: first pullback to anchored VWAP after bullish displacement close across VWAP.',
          };
          currentContinuation = null;
        } else if (candle.close < vwap && isDisplacement) {
          // Invalidated by opposite displacement across VWAP
          currentContinuation = null;
        }
      } else {
        currentContinuation.swingExtreme = Math.max(currentContinuation.swingExtreme, candle.high);
        const touchedVwap = candle.high >= vwap;
        const closedBearBelow = candle.close < vwap && candle.close < candle.open;
        if (touchedVwap && closedBearBelow) {
          const rawStop = currentContinuation.swingExtreme + 0.25 * atr;
          const rawDist = Math.abs(candle.close - rawStop);
          const stopDistance = Math.max(rawDist, pairSettings.minStop);
          const stopPrice = candle.close + stopDistance;

          candidateSignal = {
            pair,
            direction: 'SELL',
            setupType: 'ACTIVE_VWAP_PULLBACK',
            candleEpoch: candle.epoch,
            entryReferencePrice: candle.close,
            rawStopPrice: rawStop,
            stopPrice,
            stopDistance,
            vwapAtSignal: vwap,
            atrAtSignal: atr,
            reason: 'Active mode: first pullback to anchored VWAP after bearish displacement close across VWAP.',
          };
          currentContinuation = null;
        } else if (candle.close > vwap && isDisplacement) {
          currentContinuation = null;
        }
      }
    }

    // Check if this candle is a fresh displacement cross across VWAP (arms continuation for next pullback)
    if (!candidateSignal && isDisplacement && prevCandle && prevVwap !== null) {
      const crossedUp =
        (prevCandle.close <= prevVwap || candle.open <= vwap) &&
        candle.close > vwap &&
        candle.close > candle.open;
      const crossedDown =
        (prevCandle.close >= prevVwap || candle.open >= vwap) &&
        candle.close < vwap &&
        candle.close < candle.open;

      if (crossedUp) {
        currentContinuation = {
          id: `cont-${pair}-${candle.epoch}`,
          direction: 'BUY',
          crossCandleEpoch: candle.epoch,
          swingExtreme: candle.low,
          pullbackTouched: false,
        };
        logs.push(
          makeLog(
            'SETUP',
            'Cartographer',
            'Active mode armed: bullish displacement closed above VWAP; awaiting first VWAP pullback.'
          )
        );
      } else if (crossedDown) {
        currentContinuation = {
          id: `cont-${pair}-${candle.epoch}`,
          direction: 'SELL',
          crossCandleEpoch: candle.epoch,
          swingExtreme: candle.high,
          pullbackTouched: false,
        };
        logs.push(
          makeLog(
            'SETUP',
            'Cartographer',
            'Active mode armed: bearish displacement closed below VWAP; awaiting first VWAP pullback.'
          )
        );
      }
    }
  } else if (!settings.activeMode) {
    currentContinuation = null;
  }

  // 4. If no signal, still compute baseline Guard state for agent cards
  if (!candidateSignal) {
    const baselineGuard = checkGuardRules({
      pair,
      direction: settings.allowBuys ? 'BUY' : 'SELL',
      settings,
      clock,
      balance: input.balance,
      dailyRealizedPnlUsd: input.dailyRealizedPnlUsd,
      pairTradesToday: input.pairTradesToday,
      openPositions: input.openPositions,
      feedStatus: input.feedStatus,
      symbolAvailability: input.symbolAvailability,
      killSwitchEngaged: input.killSwitchEngaged,
      liveAutoStopReason: input.liveAutoStopReason,
      executionMode: input.executionMode,
    });
    return {
      nextSweep: currentSweep,
      nextContinuation: currentContinuation,
      signal: null,
      guardCheck: baselineGuard,
      quantCheck: null,
      logs,
    };
  }

  // 5. Evaluate Quant + Guard on the candidate signal
  const quantCheck = checkQuantSpread(pairSettings.spread, candidateSignal.stopDistance);
  if (!quantCheck.allowed) {
    logs.push(makeLog('BLOCK', 'Quant', `${candidateSignal.direction} blocked: ${quantCheck.reason}`));
    return {
      nextSweep: currentSweep,
      nextContinuation: currentContinuation,
      signal: null,
      guardCheck: { allowed: true, reason: 'Not evaluated (Quant blocked).' },
      quantCheck,
      logs,
    };
  }

  const guardCheck = checkGuardRules({
    pair,
    direction: candidateSignal.direction,
    settings,
    clock,
    balance: input.balance,
    dailyRealizedPnlUsd: input.dailyRealizedPnlUsd,
    pairTradesToday: input.pairTradesToday,
    openPositions: input.openPositions,
    feedStatus: input.feedStatus,
    symbolAvailability: input.symbolAvailability,
    killSwitchEngaged: input.killSwitchEngaged,
    liveAutoStopReason: input.liveAutoStopReason,
    executionMode: input.executionMode,
  });

  if (!guardCheck.allowed) {
    logs.push(makeLog('BLOCK', 'Guard', `${candidateSignal.direction} blocked: ${guardCheck.reason}`));
    return {
      nextSweep: currentSweep,
      nextContinuation: currentContinuation,
      signal: null,
      guardCheck,
      quantCheck,
      logs,
    };
  }

  return {
    nextSweep: currentSweep,
    nextContinuation: currentContinuation,
    signal: candidateSignal,
    guardCheck,
    quantCheck,
    logs,
  };
}
