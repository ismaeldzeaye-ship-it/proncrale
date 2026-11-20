import { Direction, PairId } from './types';

export interface MultiplierLegPlan {
  legLabel: '50% @ 2R' | '25% @ 4R' | '25% Runner';
  fraction: number;
  stake: number;
  stopLossUsd: number;
  takeProfitUsd: number | null;
}

export interface MultiplierOrderPlan {
  valid: boolean;
  reason: string;
  contractType: 'MULTUP' | 'MULTDOWN';
  multiplier: number;
  totalStake: number;
  legs: MultiplierLegPlan[];
}

/**
 * Selects a valid Deriv multiplier and computes the 50/25/25 ladder contract stakes
 * so that the stop-loss USD amount across the 3 contracts equals `riskUsd` at `stopDistance`.
 */
export function computeMultiplierOrderPlan(params: {
  symbol: PairId;
  direction: Direction;
  entryPrice: number;
  stopDistance: number;
  riskUsd: number;
  availableMultipliers: number[];
  minStake: number;
  maxStake: number;
  maxStakeCap: number;
  partial1R: number;
  partial1Pct: number;
  partial2R: number;
  partial2Pct: number;
}): MultiplierOrderPlan {
  const {
    direction,
    entryPrice,
    stopDistance,
    riskUsd,
    availableMultipliers,
    minStake,
    maxStake,
    maxStakeCap,
    partial1R,
    partial1Pct,
    partial2R,
    partial2Pct,
  } = params;

  const contractType: 'MULTUP' | 'MULTDOWN' = direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';

  if (entryPrice <= 0 || stopDistance <= 0 || riskUsd <= 0) {
    return {
      valid: false,
      reason: 'Invalid price, stop distance, or risk USD.',
      contractType,
      multiplier: 0,
      totalStake: 0,
      legs: [],
    };
  }

  if (!availableMultipliers || availableMultipliers.length === 0) {
    return {
      valid: false,
      reason: 'No multiplier options returned by contracts_for.',
      contractType,
      multiplier: 0,
      totalStake: 0,
      legs: [],
    };
  }

  const pct1 = Math.max(0.01, partial1Pct / 100);
  const pct2 = Math.max(0.01, partial2Pct / 100);
  const pct3 = Math.max(0.01, 1 - pct1 - pct2);
  const fractions: Array<{
    legLabel: MultiplierLegPlan['legLabel'];
    fraction: number;
    rr: number | null;
  }> = [
    { legLabel: '50% @ 2R', fraction: pct1, rr: partial1R },
    { legLabel: '25% @ 4R', fraction: pct2, rr: partial2R },
    { legLabel: '25% Runner', fraction: pct3, rr: null },
  ];

  const stopRatio = stopDistance / entryPrice;
  const effectiveMaxStake = Math.min(maxStake, maxStakeCap);

  // Sort multipliers descending so we pick the most capital-efficient valid multiplier
  const sortedMults = [...availableMultipliers].sort((a, b) => b - a);

  for (const m of sortedMults) {
    // At stop distance: stake * m * stopRatio = riskUsd => stake = riskUsd / (m * stopRatio)
    const rawTotalStake = riskUsd / (m * stopRatio);
    const totalStake = Math.round(rawTotalStake * 100) / 100;

    // Deriv requires stop_loss <= stake (so m * stopRatio <= 1, meaning totalStake >= riskUsd)
    if (totalStake < riskUsd) continue;
    if (totalStake > effectiveMaxStake) continue;

    const legs: MultiplierLegPlan[] = fractions.map((f) => {
      const stake = Math.round(totalStake * f.fraction * 100) / 100;
      const stopLossUsd = Math.round(riskUsd * f.fraction * 100) / 100;
      const takeProfitUsd =
        f.rr !== null ? Math.round(stopLossUsd * f.rr * 100) / 100 : null;
      return {
        legLabel: f.legLabel,
        fraction: f.fraction,
        stake,
        stopLossUsd,
        takeProfitUsd,
      };
    });

    const minLegStake = Math.min(...legs.map((l) => l.stake));
    const maxLegStake = Math.max(...legs.map((l) => l.stake));
    const allStopValid = legs.every((l) => l.stopLossUsd > 0 && l.stopLossUsd <= l.stake);

    if (minLegStake >= minStake && maxLegStake <= effectiveMaxStake && allStopValid) {
      return {
        valid: true,
        reason: `Selected x${m} multiplier · Total stake $${totalStake.toFixed(2)} for $${riskUsd.toFixed(2)} stop risk.`,
        contractType,
        multiplier: m,
        totalStake,
        legs,
      };
    }
  }

  return {
    valid: false,
    reason: `No valid multiplier in [${sortedMults.join(', ')}] fits stake limits ($${minStake}-$${effectiveMaxStake}) for $${riskUsd.toFixed(2)} risk at ${(stopRatio * 100).toFixed(3)}% stop.`,
    contractType,
    multiplier: 0,
    totalStake: 0,
    legs: [],
  };
}
