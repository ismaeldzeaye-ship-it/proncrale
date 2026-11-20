import test from 'node:test';
import assert from 'node:assert/strict';
import { getSessionClockInfo, computeAsiaLondonRange } from './session';
import { computeAtrSeries, computeAnchoredVwapSeries } from './indicators';
import { evaluateClosedCandleStrategy, checkQuantSpread } from './strategy';
import {
  openPaperPosition,
  processTickOnPositions,
  closeAllPositionsManually,
  exportTradesToCsv,
} from './paperEngine';
import { computeMultiplierOrderPlan } from './derivMultiplier';
import { DEFAULT_SETTINGS, INITIAL_SYMBOL_AVAILABILITY } from './defaults';
import { Candle, SymbolAvailability } from './types';

function makeHealthySymbol(symbol: 'frxEURUSD' | 'cryBTCUSD'): SymbolAvailability {
  return {
    ...INITIAL_SYMBOL_AVAILABILITY[symbol],
    discovered: true,
    available: true,
    exchangeIsOpen: true,
    isSuspended: false,
  };
}

test('NY session clock handles EST/EDT and kill zones accurately', () => {
  // 2026-07-15 14:00:00 UTC is 10:00:00 EDT (in session 08:00-17:00, outside 07:00-10:00 KZ)
  const edt10am = Math.floor(Date.UTC(2026, 6, 15, 14, 0, 0) / 1000);
  const info1 = getSessionClockInfo(edt10am, '08:00', '17:00');
  assert.equal(info1.nyDateKey, '2026-07-15');
  assert.equal(info1.nyTimeStr, '10:00:00');
  assert.equal(info1.inSession, true);
  assert.equal(info1.activeKillZone, null);

  // 2026-07-15 12:30:00 UTC is 08:30:00 EDT (in session + AM kill zone)
  const edt830am = Math.floor(Date.UTC(2026, 6, 15, 12, 30, 0) / 1000);
  const info2 = getSessionClockInfo(edt830am, '08:00', '17:00');
  assert.equal(info2.inSession, true);
  assert.equal(info2.activeKillZone, 'London-NY AM (07:00-10:00)');

  // 2026-01-15 19:00:00 UTC is 14:00:00 EST (in session + PM kill zone)
  const est2pm = Math.floor(Date.UTC(2026, 0, 15, 19, 0, 0) / 1000);
  const info3 = getSessionClockInfo(est2pm, '08:00', '17:00');
  assert.equal(info3.nyTimeStr, '14:00:00');
  assert.equal(info3.inSession, true);
  assert.equal(info3.activeKillZone, 'NY PM (13:30-16:00)');
});

test('Asia+London range freezes from 00:00 NY to 08:00 NY', () => {
  const inSessionEpoch = Math.floor(Date.UTC(2026, 6, 15, 12, 30, 0) / 1000); // 08:30 EDT
  const clock = getSessionClockInfo(inSessionEpoch, '08:00', '17:00');

  const candles: Candle[] = [
    { epoch: clock.midnightEpoch + 3600, open: 1.1, high: 1.102, low: 1.099, close: 1.101, tickCount: 10 },
    { epoch: clock.midnightEpoch + 7200, open: 1.101, high: 1.1045, low: 1.098, close: 1.102, tickCount: 12 },
    // At session start -> must NOT be included in Asia+London range
    { epoch: clock.sessionStartEpoch, open: 1.102, high: 1.11, low: 1.09, close: 1.103, tickCount: 15 },
  ];

  const range = computeAsiaLondonRange(candles, clock);
  assert.ok(range);
  assert.equal(range.frozen, true);
  assert.equal(range.high, 1.1045);
  assert.equal(range.low, 1.098);
  assert.equal(range.candleCount, 2);
});

test('ATR(14) and anchored VWAP compute accurately with tick count volume fallback', () => {
  const candles: Candle[] = [];
  const start = 1700000000;
  for (let i = 0; i < 20; i++) {
    candles.push({
      epoch: start + i * 300,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      tickCount: i + 1,
    });
  }
  const atr = computeAtrSeries(candles, 14);
  assert.equal(atr[13], null);
  assert.ok(atr[14] !== null && atr[14]! > 2);

  const vwap = computeAnchoredVwapSeries(candles, start + 18 * 300);
  assert.equal(vwap[17], null);
  assert.ok(vwap[18] !== null);
  assert.ok(vwap[19] !== null && vwap[19]! > vwap[18]!);
});

test('Strategy detects sweep + displacement across VWAP and enforces Quant 0.2R cap', () => {
  const inSessionEpoch = Math.floor(Date.UTC(2026, 6, 15, 13, 0, 0) / 1000); // 09:00 EDT
  const clock = getSessionClockInfo(inSessionEpoch, '08:00', '17:00');
  const frozenRange = {
    nyDateKey: clock.nyDateKey,
    high: 1.105,
    low: 1.1,
    frozen: true,
    candleCount: 50,
  };

  // Candle 1: sweeps below 1.1000 to 1.0990 and closes back inside at 1.1004
  const sweepCandle: Candle = {
    epoch: inSessionEpoch - 300,
    open: 1.1008,
    high: 1.101,
    low: 1.099,
    close: 1.1004,
    tickCount: 25,
  };

  const step1 = evaluateClosedCandleStrategy({
    pair: 'frxEURUSD',
    candle: sweepCandle,
    prevCandle: null,
    atr: 0.001,
    vwap: 1.101,
    prevVwap: 1.101,
    frozenRange,
    activeSweep: null,
    activeContinuation: null,
    settings: DEFAULT_SETTINGS,
    clock,
    balance: 10000,
    dailyRealizedPnlUsd: 0,
    pairTradesToday: 0,
    openPositions: [],
    feedStatus: 'connected',
    symbolAvailability: makeHealthySymbol('frxEURUSD'),
    killSwitchEngaged: false,
    liveAutoStopReason: null,
    executionMode: 'paper',
  });

  assert.ok(step1.nextSweep);
  assert.equal(step1.nextSweep.direction, 'BUY');
  assert.equal(step1.nextSweep.sweepExtreme, 1.099);
  assert.equal(step1.signal, null);

  // Candle 2: bullish displacement candle (body 0.0014 >= 0.8 * 0.001) closing above VWAP 1.1012
  const dispCandle: Candle = {
    epoch: inSessionEpoch,
    open: 1.1005,
    high: 1.1021,
    low: 1.1004,
    close: 1.1019,
    tickCount: 40,
  };

  const step2 = evaluateClosedCandleStrategy({
    pair: 'frxEURUSD',
    candle: dispCandle,
    prevCandle: sweepCandle,
    atr: 0.001,
    vwap: 1.1012,
    prevVwap: 1.101,
    frozenRange,
    activeSweep: step1.nextSweep,
    activeContinuation: null,
    settings: DEFAULT_SETTINGS,
    clock,
    balance: 10000,
    dailyRealizedPnlUsd: 0,
    pairTradesToday: 0,
    openPositions: [],
    feedStatus: 'connected',
    symbolAvailability: makeHealthySymbol('frxEURUSD'),
    killSwitchEngaged: false,
    liveAutoStopReason: null,
    executionMode: 'paper',
  });

  assert.ok(step2.signal);
  assert.equal(step2.signal.direction, 'BUY');
  assert.equal(step2.signal.setupType, 'SWEEP_DISPLACEMENT');
  assert.equal(step2.quantCheck?.allowed, true);

  // Quant rejection check when spread > 0.2R
  const badQuant = checkQuantSpread(0.0003, 0.001); // 0.30R > 0.20R
  assert.equal(badQuant.allowed, false);
});

test('Paper engine executes half-spread fills and 3-stage partial/runner management', () => {
  const { position } = openPaperPosition({
    signal: {
      pair: 'cryBTCUSD',
      direction: 'BUY',
      setupType: 'SWEEP_DISPLACEMENT',
      candleEpoch: 1700000000,
      entryReferencePrice: 60000,
      rawStopPrice: 59800,
      stopPrice: 59800,
      stopDistance: 200,
      vwapAtSignal: 59950,
      atrAtSignal: 120,
      reason: 'Test signal',
    },
    livePrice: 60000,
    balance: 10000,
    settings: DEFAULT_SETTINGS,
    epochSeconds: 1700000000,
  });

  // Spread is $12 => half spread is $6 => BUY entry = 60006
  assert.equal(position.entryPrice, 60006);
  // Stop price = 59800 => riskDistance = 206, riskAmountUsd = 100 (1% of 10000)
  assert.equal(position.riskAmountUsd, 100);
  assert.equal(position.stage, 0);

  // Partial 1 target at 2R = 60006 + 2 * 206 = 60418; livePrice needs to be 60418 + 6 = 60424 so exitPrice = 60418
  const tick1 = processTickOnPositions({
    positions: [position],
    pair: 'cryBTCUSD',
    livePrice: 60424,
    epochSeconds: 1700000060,
    settings: DEFAULT_SETTINGS,
  });

  assert.equal(tick1.openPositions.length, 1);
  const pAfter1 = tick1.openPositions[0];
  assert.equal(pAfter1.stage, 1);
  assert.equal(pAfter1.partial1Done, true);
  // Break-even moved stop to entryPrice (60006)
  assert.equal(pAfter1.stopPrice, 60006);
  assert.ok(Math.abs(pAfter1.realizedPnl - 100) < 0.01); // 50% of 2R = 1R = $100

  // Partial 2 target at 4R = 60006 + 4 * 206 = 60830; livePrice = 60836 => exitPrice = 60830
  const tick2 = processTickOnPositions({
    positions: [pAfter1],
    pair: 'cryBTCUSD',
    livePrice: 60836,
    epochSeconds: 1700000120,
    settings: DEFAULT_SETTINGS,
  });

  assert.equal(tick2.openPositions.length, 1);
  const pAfter2 = tick2.openPositions[0];
  assert.equal(pAfter2.stage, 2);
  assert.equal(pAfter2.partial2Done, true);
  // 25% at 4R = +1R = +$100 => cumulative realized = $200
  assert.ok(Math.abs(pAfter2.realizedPnl - 200) < 0.01);

  // Session end closes remaining 25% runner
  const closed = closeAllPositionsManually({
    positions: [pAfter2],
    latestQuotes: { cryBTCUSD: 60836 },
    epochSeconds: 1700003600,
    settings: DEFAULT_SETTINGS,
    reason: 'Session end flatten',
  });
  assert.equal(closed.closedTrades.length, 1);
  assert.ok(Math.abs(closed.closedTrades[0].pnlUsd - 300) < 0.01);

  const csv = exportTradesToCsv(closed.closedTrades);
  assert.ok(csv.includes('cryBTCUSD'));
  assert.ok(csv.includes('Session end flatten'));
});

test('Deriv multiplier calculator computes 50/25/25 ladder matching stop-loss risk USD', () => {
  const plan = computeMultiplierOrderPlan({
    symbol: 'frxEURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopDistance: 0.0011, // 0.1% stop
    riskUsd: 100,
    availableMultipliers: [100, 200, 300, 500, 800],
    minStake: 1,
    maxStake: 2000,
    maxStakeCap: 500,
    partial1R: 2,
    partial1Pct: 50,
    partial2R: 4,
    partial2Pct: 25,
  });

  assert.equal(plan.valid, true);
  // At 0.1% stop, x800 => 80% loss on stake, so totalStake = 100 / 0.8 = 125
  assert.equal(plan.multiplier, 800);
  assert.equal(plan.totalStake, 125);
  assert.equal(plan.legs.length, 3);
  assert.equal(plan.legs[0].stopLossUsd, 50);
  assert.equal(plan.legs[0].takeProfitUsd, 100);
  assert.equal(plan.legs[1].stopLossUsd, 25);
  assert.equal(plan.legs[1].takeProfitUsd, 100);
  assert.equal(plan.legs[2].stopLossUsd, 25);
  assert.equal(plan.legs[2].takeProfitUsd, null);
});

test('Active mode triggers VWAP continuation on first pullback after displacement close across VWAP', () => {
  const inSessionEpoch = Math.floor(Date.UTC(2026, 6, 15, 14, 0, 0) / 1000); // 10:00 EDT
  const clock = getSessionClockInfo(inSessionEpoch, '08:00', '17:00');
  const prevCandle: Candle = {
    epoch: inSessionEpoch - 600,
    open: 60100,
    high: 60120,
    low: 59950,
    close: 59980,
    tickCount: 20,
  };
  // Displacement candle crossing above VWAP 60000
  const crossCandle: Candle = {
    epoch: inSessionEpoch - 300,
    open: 59970,
    high: 60150,
    low: 59960,
    close: 60130,
    tickCount: 30,
  };

  const step1 = evaluateClosedCandleStrategy({
    pair: 'cryBTCUSD',
    candle: crossCandle,
    prevCandle,
    atr: 100,
    vwap: 60000,
    prevVwap: 60000,
    frozenRange: null,
    activeSweep: null,
    activeContinuation: null,
    settings: DEFAULT_SETTINGS,
    clock,
    balance: 10000,
    dailyRealizedPnlUsd: 0,
    pairTradesToday: 0,
    openPositions: [],
    feedStatus: 'connected',
    symbolAvailability: makeHealthySymbol('cryBTCUSD'),
    killSwitchEngaged: false,
    liveAutoStopReason: null,
    executionMode: 'paper',
  });

  assert.ok(step1.nextContinuation);
  assert.equal(step1.nextContinuation.direction, 'BUY');
  assert.equal(step1.signal, null);

  // Pullback candle touching VWAP 60010 (low 59995 <= 60010) and closing bullish above VWAP
  const pullbackCandle: Candle = {
    epoch: inSessionEpoch,
    open: 60020,
    high: 60120,
    low: 59995,
    close: 60090,
    tickCount: 25,
  };

  const step2 = evaluateClosedCandleStrategy({
    pair: 'cryBTCUSD',
    candle: pullbackCandle,
    prevCandle: crossCandle,
    atr: 100,
    vwap: 60010,
    prevVwap: 60000,
    frozenRange: null,
    activeSweep: null,
    activeContinuation: step1.nextContinuation,
    settings: DEFAULT_SETTINGS,
    clock,
    balance: 10000,
    dailyRealizedPnlUsd: 0,
    pairTradesToday: 0,
    openPositions: [],
    feedStatus: 'connected',
    symbolAvailability: makeHealthySymbol('cryBTCUSD'),
    killSwitchEngaged: false,
    liveAutoStopReason: null,
    executionMode: 'paper',
  });

  assert.ok(step2.signal);
  assert.equal(step2.signal.direction, 'BUY');
  assert.equal(step2.signal.setupType, 'ACTIVE_VWAP_PULLBACK');
  assert.equal(step2.nextContinuation, null);
});
