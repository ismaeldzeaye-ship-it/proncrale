import { Candle } from './types';

export function getCandleVolume(candle: Candle): number {
  if (typeof candle.volume === 'number' && Number.isFinite(candle.volume) && candle.volume > 0) {
    return candle.volume;
  }
  return Math.max(1, candle.tickCount || 0);
}

/**
 * Wilder's ATR(14) aligned 1:1 with candles array.
 * Returns null for indices < period.
 */
export function computeAtrSeries(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return result;

  const trueRanges: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trueRanges[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      trueRanges[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
    }
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += trueRanges[i];
  }
  let atr = sum / period;
  result[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }

  return result;
}

/**
 * Anchored VWAP starting at `anchorEpoch` (inclusive).
 * Uses tick count as volume when candle.volume is absent.
 */
export function computeAnchoredVwapSeries(
  candles: Candle[],
  anchorEpoch: number
): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.epoch < anchorEpoch) {
      result[i] = null;
      continue;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = getCandleVolume(c);
    cumPv += typicalPrice * vol;
    cumVol += vol;
    result[i] = cumVol > 0 ? cumPv / cumVol : null;
  }

  return result;
}
