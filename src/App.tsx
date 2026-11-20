import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Moon,
  OctagonAlert,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import {
  AgentStatus,
  Candle,
  ContinuationSetup,
  ExecutionMode,
  FeedStatus,
  LiveExecutionGroup,
  LiveOrderLogEntry,
  PairId,
  PersistedState,
  SweepSetup,
  SymbolAvailability,
  TickData,
} from './engine/types';
import { INITIAL_SYMBOL_AVAILABILITY } from './engine/defaults';
import { loadPersistedState, savePersistedState } from './engine/storage';
import {
  computeAsiaLondonRange,
  formatNyTime,
  getSessionClockInfo,
} from './engine/session';
import { computeAnchoredVwapSeries, computeAtrSeries } from './engine/indicators';
import {
  FREQUENCY_PARAMS,
  checkGuardRules,
  checkQuantSpread,
  evaluateClosedCandleStrategy,
} from './engine/strategy';
import {
  closeAllPositionsManually,
  exportTradesToCsv,
  openPaperPosition,
  processTickOnPositions,
} from './engine/paperEngine';
import { DerivPublicFeed } from './services/derivPublicFeed';
import { DerivLiveClient } from './services/derivLiveClient';
import { PriceChart } from './components/PriceChart';
import { EquityCurveChart } from './components/EquityCurveChart';
import { AgentGrid } from './components/AgentGrid';
import { LiveExecutionPanel } from './components/LiveExecutionPanel';
import { PositionsAndLogs } from './components/PositionsAndLogs';
import { SettingsDrawer } from './components/SettingsDrawer';
import { RealConfirmModal } from './components/RealConfirmModal';

const PAIRS: PairId[] = ['frxEURUSD', 'cryBTCUSD'];

export default function App() {
  const initialClock = useMemo(
    () => getSessionClockInfo(Math.floor(Date.now() / 1000), '08:00', '17:00'),
    []
  );

  const [persisted, setPersisted] = useState<PersistedState>(() =>
    loadPersistedState(initialClock.nyDateKey)
  );

  // Sync theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', persisted.theme === 'dark');
  }, [persisted.theme]);

  // Save state to localStorage (never includes API token or Real confirmation)
  useEffect(() => {
    savePersistedState(persisted);
  }, [persisted]);

  const [nowEpoch, setNowEpoch] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('connecting');
  const [feedDetail, setFeedDetail] = useState<string>('Initializing WebSocket...');
  const [symbolAvailability, setSymbolAvailability] = useState<
    Record<PairId, SymbolAvailability>
  >(INITIAL_SYMBOL_AVAILABILITY);
  const [candlesByPair, setCandlesByPair] = useState<Record<PairId, Candle[]>>({
    frxEURUSD: [],
    cryBTCUSD: [],
  });
  const [ticksByPair, setTicksByPair] = useState<Partial<Record<PairId, TickData>>>({});
  const [lastTickEpochByPair, setLastTickEpochByPair] = useState<
    Partial<Record<PairId, number>>
  >({});

  // Ephemeral strategy state per pair
  const sweepRef = useRef<Record<PairId, SweepSetup | null>>({
    frxEURUSD: null,
    cryBTCUSD: null,
  });
  const continuationRef = useRef<Record<PairId, ContinuationSetup | null>>({
    frxEURUSD: null,
    cryBTCUSD: null,
  });
  const lastQuantRef = useRef<
    Record<PairId, { allowed: boolean; spreadCostR: number; reason: string } | null>
  >({
    frxEURUSD: null,
    cryBTCUSD: null,
  });

  // UI Drawers / Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [realModalOpen, setRealModalOpen] = useState(false);

  // Live Execution Mode (in-memory only; always starts in Paper)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('paper');
  const [realConfirmedThisRun, setRealConfirmedThisRun] = useState(false);
  const [killSwitchEngaged, setKillSwitchEngaged] = useState(false);
  const [liveAutoStopReason, setLiveAutoStopReason] = useState<string | null>(null);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveConnState, setLiveConnState] = useState<{
    connected: boolean;
    mode: 'demo' | 'real' | null;
    accountId: string | null;
    currency: string;
    balance: number | null;
    error: string | null;
  }>({
    connected: false,
    mode: null,
    accountId: null,
    currency: 'USD',
    balance: null,
    error: null,
  });
  const [liveOrderLog, setLiveOrderLog] = useState<LiveOrderLogEntry[]>([]);

  // Refs for callbacks inside WebSocket handlers
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  const symbolAvailRef = useRef(symbolAvailability);
  symbolAvailRef.current = symbolAvailability;
  const feedStatusRef = useRef(feedStatus);
  feedStatusRef.current = feedStatus;
  const ticksRef = useRef(ticksByPair);
  ticksRef.current = ticksByPair;
  const candlesRef = useRef(candlesByPair);
  candlesRef.current = candlesByPair;
  const executionModeRef = useRef(executionMode);
  executionModeRef.current = executionMode;
  const killSwitchRef = useRef(killSwitchEngaged);
  killSwitchRef.current = killSwitchEngaged;
  const autoStopRef = useRef(liveAutoStopReason);
  autoStopRef.current = liveAutoStopReason;

  // Live Deriv Client ref
  const liveClientRef = useRef<DerivLiveClient | null>(null);
  if (!liveClientRef.current) {
    liveClientRef.current = new DerivLiveClient({
      onConnectionChange: (st) => {
        setLiveConnState(st);
      },
      onOrderLog: (entry) => {
        setLiveOrderLog((prev) => [entry, ...prev].slice(0, 150));
      },
      onGroupUpdate: (group: LiveExecutionGroup) => {
        setPersisted((prev) => {
          const exists = prev.liveGroups.some((g) => g.id === group.id);
          const nextGroups = exists
            ? prev.liveGroups.map((g) => (g.id === group.id ? group : g))
            : [group, ...prev.liveGroups].slice(0, 50);
          return { ...prev, liveGroups: nextGroups };
        });
      },
      onAutoStop: (reason) => {
        setLiveAutoStopReason(reason);
      },
    });
  }

  // Current NY session clock
  const clock = useMemo(
    () =>
      getSessionClockInfo(
        nowEpoch,
        persisted.settings.sessionStart,
        persisted.settings.sessionEnd
      ),
    [nowEpoch, persisted.settings.sessionStart, persisted.settings.sessionEnd]
  );

  // 1s NY clock tick + NY midnight reset + session-end flatten
  useEffect(() => {
    const timer = window.setInterval(() => {
      const epoch = Math.floor(Date.now() / 1000);
      setNowEpoch(epoch);

      const st = persistedRef.current;
      const clk = getSessionClockInfo(
        epoch,
        st.settings.sessionStart,
        st.settings.sessionEnd
      );

      // Roll over daily stats on NY midnight
      if (clk.nyDateKey !== st.dailyStats.nyDateKey) {
        sweepRef.current = { frxEURUSD: null, cryBTCUSD: null };
        continuationRef.current = { frxEURUSD: null, cryBTCUSD: null };
        setPersisted((prev) => ({
          ...prev,
          dailyStats: {
            nyDateKey: clk.nyDateKey,
            tradesCount: { frxEURUSD: 0, cryBTCUSD: 0 },
            realizedPnlUsd: 0,
            liveTradesCount: 0,
            liveRealizedPnlUsd: 0,
            lastProcessedCandleEpoch: prev.dailyStats.lastProcessedCandleEpoch,
          },
        }));
      }

      // Close all open paper positions & live runners at session end
      if (clk.sessionStateLabel === 'POST-SESSION' && st.openPositions.length > 0) {
        const latestQuotes: Partial<Record<PairId, number>> = {
          frxEURUSD: ticksRef.current.frxEURUSD?.quote,
          cryBTCUSD: ticksRef.current.cryBTCUSD?.quote,
        };
        const closed = closeAllPositionsManually({
          positions: st.openPositions,
          latestQuotes,
          epochSeconds: epoch,
          settings: st.settings,
          reason: 'Session end flatten (NY close)',
        });

        setPersisted((prev) => {
          const nextBalance = prev.balance + closed.realizedPnlDelta;
          return {
            ...prev,
            balance: nextBalance,
            openPositions: [],
            closedTrades: [...closed.closedTrades, ...prev.closedTrades].slice(0, 500),
            decisionLog: [...closed.logs, ...prev.decisionLog].slice(0, 400),
            dailyStats: {
              ...prev.dailyStats,
              realizedPnlUsd: prev.dailyStats.realizedPnlUsd + closed.realizedPnlDelta,
            },
            equityCurve: [
              ...prev.equityCurve,
              {
                epoch,
                nyTime: clk.nyTimeStr,
                equity: nextBalance,
                balance: nextBalance,
              },
            ].slice(-200),
          };
        });

        if (liveClientRef.current?.isConnected()) {
          liveClientRef.current.closeAllOpenContracts('Session end flatten').catch(() => {});
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  // Strategy evaluation when a 5m candle closes
  const handleClosedCandle = useCallback((pair: PairId, closedCandle: Candle) => {
    const st = persistedRef.current;
    const lastProcessed = st.dailyStats.lastProcessedCandleEpoch[pair];
    if (lastProcessed !== undefined && closedCandle.epoch <= lastProcessed) {
      return;
    }

    const pairCandles = candlesRef.current[pair] || [];
    const idx = pairCandles.findIndex((c) => c.epoch === closedCandle.epoch);
    const closedSlice = idx >= 0 ? pairCandles.slice(0, idx + 1) : [...pairCandles, closedCandle];
    const clk = getSessionClockInfo(
      closedCandle.epoch + 300,
      st.settings.sessionStart,
      st.settings.sessionEnd
    );
    const frozenRange = computeAsiaLondonRange(closedSlice, clk);
    const atrSeries = computeAtrSeries(closedSlice, 14);
    const vwapSeries = computeAnchoredVwapSeries(closedSlice, clk.sessionStartEpoch);

    const lastIdx = closedSlice.length - 1;
    const prevCandle = lastIdx > 0 ? closedSlice[lastIdx - 1] : null;
    const atr = atrSeries[lastIdx] ?? null;
    const vwap = vwapSeries[lastIdx] ?? null;
    const prevVwap = lastIdx > 0 ? (vwapSeries[lastIdx - 1] ?? null) : null;

    const evalRes = evaluateClosedCandleStrategy({
      pair,
      candle: closedCandle,
      prevCandle,
      atr,
      vwap,
      prevVwap,
      frozenRange,
      activeSweep: sweepRef.current[pair],
      activeContinuation: continuationRef.current[pair],
      settings: st.settings,
      clock: clk,
      balance: st.balance,
      dailyRealizedPnlUsd: st.dailyStats.realizedPnlUsd,
      pairTradesToday: st.dailyStats.tradesCount[pair] ?? 0,
      openPositions: st.openPositions,
      feedStatus: feedStatusRef.current,
      symbolAvailability: symbolAvailRef.current[pair],
      killSwitchEngaged: killSwitchRef.current,
      liveAutoStopReason: autoStopRef.current,
      executionMode: executionModeRef.current,
    });

    sweepRef.current[pair] = evalRes.nextSweep;
    continuationRef.current[pair] = evalRes.nextContinuation;
    if (evalRes.quantCheck) {
      lastQuantRef.current[pair] = evalRes.quantCheck;
    }

    const newLogs = [...evalRes.logs];
    let openedPosition = null;

    if (evalRes.signal) {
      const liveQuote = ticksRef.current[pair]?.quote ?? closedCandle.close;
      const openRes = openPaperPosition({
        signal: evalRes.signal,
        livePrice: liveQuote,
        balance: st.balance,
        settings: st.settings,
        epochSeconds: Math.floor(Date.now() / 1000),
      });
      openedPosition = openRes.position;
      newLogs.unshift(openRes.log);

      // Mirror to Deriv Demo / Real gateway when live mode is active & connected
      const mode = executionModeRef.current;
      if (
        mode !== 'paper' &&
        liveClientRef.current?.isConnected() &&
        !killSwitchRef.current &&
        !autoStopRef.current &&
        evalRes.guardCheck.allowed
      ) {
        liveClientRef.current
          .executeLadderTrade({
            mode,
            paperTradeId: openRes.position.id,
            pair,
            direction: evalRes.signal.direction,
            entryPrice: openRes.position.entryPrice,
            stopDistance: openRes.position.riskDistance,
            riskUsd: openRes.position.riskAmountUsd,
            symbolInfo: symbolAvailRef.current[pair],
            settings: st.settings,
            dailyLiveTrades: st.dailyStats.liveTradesCount,
            dailyLivePnlUsd: st.dailyStats.liveRealizedPnlUsd,
          })
          .then((grp) => {
            if (grp) {
              setPersisted((prev) => ({
                ...prev,
                dailyStats: {
                  ...prev.dailyStats,
                  liveTradesCount: prev.dailyStats.liveTradesCount + 1,
                },
              }));
            }
          })
          .catch(() => {});
      }
    }

    setPersisted((prev) => ({
      ...prev,
      openPositions: openedPosition
        ? [...prev.openPositions, openedPosition]
        : prev.openPositions,
      decisionLog: [...newLogs, ...prev.decisionLog].slice(0, 400),
      dailyStats: {
        ...prev.dailyStats,
        tradesCount: openedPosition
          ? {
              ...prev.dailyStats.tradesCount,
              [pair]: (prev.dailyStats.tradesCount[pair] ?? 0) + 1,
            }
          : prev.dailyStats.tradesCount,
        lastProcessedCandleEpoch: {
          ...prev.dailyStats.lastProcessedCandleEpoch,
          [pair]: closedCandle.epoch,
        },
      },
    }));
  }, []);

  // Connect Deriv Public WebSocket on mount
  const handleClosedCandleRef = useRef(handleClosedCandle);
  handleClosedCandleRef.current = handleClosedCandle;

  const publicFeedRef = useRef<DerivPublicFeed | null>(null);
  useEffect(() => {
    const feed = new DerivPublicFeed(INITIAL_SYMBOL_AVAILABILITY, {
      onStatusChange: (status, detail) => {
        setFeedStatus(status);
        if (detail) setFeedDetail(detail);
        if ((status === 'down' || status === 'reconnecting') && executionModeRef.current !== 'paper') {
          setLiveAutoStopReason('Feed down / reconnecting');
        }
      },
      onSymbolsResolved: (avail) => {
        setSymbolAvailability(avail);
      },
      onCandlesSnapshot: (pair, candles) => {
        setCandlesByPair((prev) => ({ ...prev, [pair]: candles }));
        // Initialize lastProcessedCandleEpoch to latest closed bar so we evaluate live closes going forward
        if (candles.length >= 2) {
          const latestClosed = candles[candles.length - 2].epoch;
          setPersisted((prev) => ({
            ...prev,
            dailyStats: {
              ...prev.dailyStats,
              lastProcessedCandleEpoch: {
                ...prev.dailyStats.lastProcessedCandleEpoch,
                [pair]: Math.max(
                  prev.dailyStats.lastProcessedCandleEpoch[pair] ?? 0,
                  latestClosed
                ),
              },
            },
          }));
        }
      },
      onCandleUpdate: (pair, candle, closedPrev) => {
        setCandlesByPair((prev) => {
          const list = prev[pair] || [];
          const last = list[list.length - 1];
          let nextList: Candle[];
          if (last && last.epoch === candle.epoch) {
            nextList = [...list.slice(0, -1), candle];
          } else {
            nextList = [...list.slice(-499), candle];
          }
          return { ...prev, [pair]: nextList };
        });

        if (closedPrev) {
          handleClosedCandleRef.current(pair, closedPrev);
        }
      },
      onTick: (tick) => {
        setTicksByPair((prev) => ({ ...prev, [tick.symbol]: tick }));
        setLastTickEpochByPair((prev) => ({ ...prev, [tick.symbol]: tick.epoch }));

        // Increment tick count in React candle state as well so VWAP updates live
        const bucketEpoch = Math.floor(tick.epoch / 300) * 300;
        setCandlesByPair((prev) => {
          const list = prev[tick.symbol];
          if (!list || list.length === 0) return prev;
          const last = list[list.length - 1];
          if (last.epoch !== bucketEpoch) return prev;
          const updated = { ...last, tickCount: last.tickCount + 1, close: tick.quote };
          return {
            ...prev,
            [tick.symbol]: [...list.slice(0, -1), updated],
          };
        });

        // Process open paper positions on every tick
        const st = persistedRef.current;
        if (st.openPositions.some((p) => p.pair === tick.symbol)) {
          const res = processTickOnPositions({
            positions: st.openPositions,
            pair: tick.symbol,
            livePrice: tick.quote,
            epochSeconds: tick.epoch,
            settings: st.settings,
          });

          setPersisted((prev) => {
            const nextBalance = prev.balance + res.realizedPnlDelta;
            const totalUnrealized = res.openPositions.reduce(
              (acc, p) => acc + p.unrealizedPnl,
              0
            );
            const nextEquity = nextBalance + totalUnrealized;
            const shouldAppendEquity =
              res.newlyClosedTrades.length > 0 || res.partial1TriggeredPositions.length > 0;

            return {
              ...prev,
              balance: nextBalance,
              openPositions: res.openPositions,
              closedTrades: [...res.newlyClosedTrades, ...prev.closedTrades].slice(0, 500),
              decisionLog: [...res.logs, ...prev.decisionLog].slice(0, 400),
              dailyStats: {
                ...prev.dailyStats,
                realizedPnlUsd: prev.dailyStats.realizedPnlUsd + res.realizedPnlDelta,
              },
              equityCurve: shouldAppendEquity
                ? [
                    ...prev.equityCurve,
                    {
                      epoch: tick.epoch,
                      nyTime: formatNyTime(tick.epoch),
                      equity: nextEquity,
                      balance: nextBalance,
                    },
                  ].slice(-200)
                : prev.equityCurve,
            };
          });
        }
      },
    });

    publicFeedRef.current = feed;
    feed.start();
    return () => {
      feed.stop();
    };
  }, []);

  // Derived analytics for active selectedPair
  const activePair = persisted.selectedPair;
  const activeCandles = candlesByPair[activePair] || [];
  const activeAtrSeries = useMemo(() => computeAtrSeries(activeCandles, 14), [activeCandles]);
  const activeVwapSeries = useMemo(
    () => computeAnchoredVwapSeries(activeCandles, clock.sessionStartEpoch),
    [activeCandles, clock.sessionStartEpoch]
  );
  const activeFrozenRange = useMemo(
    () => computeAsiaLondonRange(activeCandles, clock),
    [activeCandles, clock]
  );

  // Portfolio metrics
  const totalUnrealizedUsd = persisted.openPositions.reduce(
    (sum, p) => sum + p.unrealizedPnl,
    0
  );
  const totalEquity = persisted.balance + totalUnrealizedUsd;
  const winsCount = persisted.closedTrades.filter((t) => t.pnlUsd > 0).length;
  const winRatePct =
    persisted.closedTrades.length > 0
      ? (winsCount / persisted.closedTrades.length) * 100
      : 0;

  // Live Six Agents Status derived for activePair
  const agents: AgentStatus[] = useMemo(() => {
    const precision = activePair === 'frxEURUSD' ? 5 : 2;
    const latestAtr = activeAtrSeries[activeAtrSeries.length - 1] ?? null;
    const latestVwap = activeVwapSeries[activeVwapSeries.length - 1] ?? null;
    const latestCandle = activeCandles[activeCandles.length - 1] ?? null;
    const liveTick = ticksByPair[activePair];
    const sweep = sweepRef.current[activePair];
    const cont = continuationRef.current[activePair];
    const { sweepWindow, displacementMultiplier } = FREQUENCY_PARAMS[persisted.settings.frequency];
    const pairSettings = persisted.settings.pairs[activePair];

    // 1. Scout
    const scoutHeadline = activeFrozenRange
      ? `${activeFrozenRange.frozen ? 'Frozen' : 'Forming'} A+L ${activeFrozenRange.low.toFixed(precision)} – ${activeFrozenRange.high.toFixed(precision)}`
      : `Building Asia+London range (${clock.nyTimeStr} NY)`;
    const scoutDetail = `${clock.sessionStateLabel} (${persisted.settings.sessionStart}–${persisted.settings.sessionEnd} NY) · ${
      clock.activeKillZone ? `In ${clock.activeKillZone}` : 'Outside kill zones'
    }`;

    // 2. Cartographer
    const vwapTxt = latestVwap !== null ? latestVwap.toFixed(precision) : '—';
    const atrTxt = latestAtr !== null ? latestAtr.toFixed(precision) : '—';
    const cartoHeadline = `VWAP ${vwapTxt} · ATR(14) ${atrTxt}`;
    const cartoDetail = sweep
      ? `${sweep.direction} sweep active (${sweep.candlesRemaining}/${sweep.totalWindow} bars left)`
      : cont
      ? `Active mode: ${cont.direction} VWAP pullback armed`
      : latestCandle
      ? `Last close ${latestCandle.close.toFixed(precision)} (${latestCandle.tickCount} ticks vol)`
      : 'Waiting for 5m candles...';

    // 3. Judge
    const judgeHeadline = sweep
      ? `Sweep Setup (${sweep.direction})`
      : cont
      ? `Continuation Armed (${cont.direction})`
      : 'Scanning for Setup';
    const judgeDetail = `Preset: ${persisted.settings.frequency} (N=${sweepWindow}, k=${displacementMultiplier}x ATR) · Active mode ${
      persisted.settings.activeMode ? 'ON' : 'OFF'
    }`;

    // 4. Quant
    const estStopDist = Math.max(pairSettings.minStop, latestAtr ? latestAtr * 1.25 : pairSettings.minStop);
    const estQuant = lastQuantRef.current[activePair] ?? checkQuantSpread(pairSettings.spread, estStopDist);
    const quantHeadline = estQuant.allowed
      ? `Spread ${estQuant.spreadCostR.toFixed(2)}R <= 0.20R`
      : `Rejected (${estQuant.spreadCostR.toFixed(2)}R > 0.20R)`;
    const quantDetail = `Spread ${pairSettings.spread} · Min stop ${pairSettings.minStop} · Risk ${persisted.settings.riskPct}% ($${(
      persisted.balance *
      (persisted.settings.riskPct / 100)
    ).toFixed(2)})`;

    // 5. Guard
    const guardRes = checkGuardRules({
      pair: activePair,
      direction: persisted.settings.allowBuys ? 'BUY' : 'SELL',
      settings: persisted.settings,
      clock,
      balance: persisted.balance,
      dailyRealizedPnlUsd: persisted.dailyStats.realizedPnlUsd,
      pairTradesToday: persisted.dailyStats.tradesCount[activePair] ?? 0,
      openPositions: persisted.openPositions,
      feedStatus,
      symbolAvailability: symbolAvailability[activePair],
      killSwitchEngaged,
      liveAutoStopReason,
      executionMode,
    });
    const guardHeadline = guardRes.allowed ? 'Cleared for Entry' : 'Blocked';
    const guardDetail = guardRes.allowed
      ? `Trades ${persisted.dailyStats.tradesCount[activePair] ?? 0}/${persisted.settings.maxTradesPerPairPerDay} · Daily PnL $${persisted.dailyStats.realizedPnlUsd.toFixed(2)}`
      : guardRes.reason;

    // 6. Executor
    const openForPair = persisted.openPositions.find((p) => p.pair === activePair);
    const execHeadline = openForPair
      ? `Managing ${openForPair.direction} · Stage ${openForPair.stage}`
      : executionMode === 'paper'
      ? 'Paper Engine Armed'
      : `Deriv ${executionMode.toUpperCase()} ${liveConnState.connected ? 'Connected' : 'Standby'}`;
    const execDetail = openForPair
      ? `Entry ${openForPair.entryPrice.toFixed(precision)} · SL ${openForPair.stopPrice.toFixed(precision)} · Unrealized ${openForPair.unrealizedR >= 0 ? '+' : ''}${openForPair.unrealizedR.toFixed(2)}R`
      : liveTick
      ? `Live ${liveTick.quote.toFixed(precision)} · ${persisted.closedTrades.length} closed trades`
      : 'Awaiting live tick stream';

    return [
      {
        name: 'Scout',
        role: 'Session & Range',
        status: clock.inSession ? 'active' : 'warning',
        headline: scoutHeadline,
        detail: scoutDetail,
        updatedAt: clock.nyTimeStr,
      },
      {
        name: 'Cartographer',
        role: 'VWAP & Sweeps',
        status: sweep || cont ? 'active' : 'nominal',
        headline: cartoHeadline,
        detail: cartoDetail,
        updatedAt: clock.nyTimeStr,
      },
      {
        name: 'Judge',
        role: 'Setup State',
        status: sweep || cont ? 'active' : 'nominal',
        headline: judgeHeadline,
        detail: judgeDetail,
        updatedAt: clock.nyTimeStr,
      },
      {
        name: 'Quant',
        role: 'Spread & Risk',
        status: estQuant.allowed ? 'nominal' : 'blocked',
        headline: quantHeadline,
        detail: quantDetail,
        updatedAt: clock.nyTimeStr,
      },
      {
        name: 'Guard',
        role: 'Risk & Gates',
        status: guardRes.allowed ? 'active' : 'blocked',
        headline: guardHeadline,
        detail: guardDetail,
        updatedAt: clock.nyTimeStr,
      },
      {
        name: 'Executor',
        role: 'Order & Stages',
        status: openForPair ? 'active' : killSwitchEngaged ? 'blocked' : 'nominal',
        headline: execHeadline,
        detail: execDetail,
        updatedAt: clock.nyTimeStr,
      },
    ];
  }, [
    activePair,
    activeAtrSeries,
    activeVwapSeries,
    activeCandles,
    activeFrozenRange,
    ticksByPair,
    persisted,
    clock,
    feedStatus,
    symbolAvailability,
    killSwitchEngaged,
    liveAutoStopReason,
    executionMode,
    liveConnState.connected,
  ]);

  // Handlers
  const handleModeSwitch = (target: ExecutionMode) => {
    if (target === executionMode) return;
    if (target === 'real' && !realConfirmedThisRun) {
      setRealModalOpen(true);
      return;
    }
    if (target === 'paper') {
      liveClientRef.current?.disconnect();
      setLiveAutoStopReason(null);
    } else if (executionMode !== target) {
      liveClientRef.current?.disconnect();
    }
    setExecutionMode(target);
  };

  const handleKillSwitchToggle = async () => {
    if (!killSwitchEngaged) {
      setKillSwitchEngaged(true);
      const epoch = Math.floor(Date.now() / 1000);
      const latestQuotes: Partial<Record<PairId, number>> = {
        frxEURUSD: ticksRef.current.frxEURUSD?.quote,
        cryBTCUSD: ticksRef.current.cryBTCUSD?.quote,
      };
      const flattened = closeAllPositionsManually({
        positions: persisted.openPositions,
        latestQuotes,
        epochSeconds: epoch,
        settings: persisted.settings,
        reason: 'Kill switch engaged',
      });

      setPersisted((prev) => ({
        ...prev,
        balance: prev.balance + flattened.realizedPnlDelta,
        openPositions: [],
        closedTrades: [...flattened.closedTrades, ...prev.closedTrades].slice(0, 500),
        decisionLog: [
          {
            id: `kill-${epoch}`,
            timestampEpoch: epoch,
            nyTime: formatNyTime(epoch),
            pair: 'SYSTEM' as const,
            type: 'BLOCK' as const,
            agent: 'Guard' as const,
            message: 'Kill switch engaged: flattened open positions and blocked new entries.',
          },
          ...flattened.logs,
          ...prev.decisionLog,
        ].slice(0, 400),
      }));

      if (liveClientRef.current?.isConnected()) {
        await liveClientRef.current.closeAllOpenContracts('Kill switch engaged');
      }
    } else {
      setKillSwitchEngaged(false);
    }
  };

  const handleManualClosePosition = (id: string) => {
    const pos = persisted.openPositions.find((p) => p.id === id);
    if (!pos) return;
    const epoch = Math.floor(Date.now() / 1000);
    const closed = closeAllPositionsManually({
      positions: [pos],
      latestQuotes: { [pos.pair]: ticksRef.current[pos.pair]?.quote },
      epochSeconds: epoch,
      settings: persisted.settings,
      reason: 'Manual close',
    });

    setPersisted((prev) => {
      const nextBalance = prev.balance + closed.realizedPnlDelta;
      return {
        ...prev,
        balance: nextBalance,
        openPositions: prev.openPositions.filter((p) => p.id !== id),
        closedTrades: [...closed.closedTrades, ...prev.closedTrades].slice(0, 500),
        decisionLog: [...closed.logs, ...prev.decisionLog].slice(0, 400),
        dailyStats: {
          ...prev.dailyStats,
          realizedPnlUsd: prev.dailyStats.realizedPnlUsd + closed.realizedPnlDelta,
        },
        equityCurve: [
          ...prev.equityCurve,
          {
            epoch,
            nyTime: formatNyTime(epoch),
            equity: nextBalance,
            balance: nextBalance,
          },
        ].slice(-200),
      };
    });
  };

  const handleExportCsv = () => {
    const csv = exportTradesToCsv(persisted.closedTrades);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ict-vwap-journal-${clock.nyDateKey}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleResetPaperJournal = () => {
    sweepRef.current = { frxEURUSD: null, cryBTCUSD: null };
    continuationRef.current = { frxEURUSD: null, cryBTCUSD: null };
    setPersisted((prev) => ({
      ...prev,
      balance: prev.settings.startBalance,
      openPositions: [],
      closedTrades: [],
      equityCurve: [],
      decisionLog: [],
      liveGroups: [],
      dailyStats: {
        nyDateKey: clock.nyDateKey,
        tradesCount: { frxEURUSD: 0, cryBTCUSD: 0 },
        realizedPnlUsd: 0,
        liveTradesCount: 0,
        liveRealizedPnlUsd: 0,
        lastProcessedCandleEpoch: prev.dailyStats.lastProcessedCandleEpoch,
      },
    }));
  };

  const handleLiveConnect = async (token: string, appId: string, accountId: string) => {
    if (executionMode === 'paper' || !liveClientRef.current) return;
    setLiveConnecting(true);
    try {
      await liveClientRef.current.connectWithToken({
        mode: executionMode,
        token,
        appId,
        preferredAccountId: accountId,
      });
    } catch (err) {
      setLiveConnState((prev) => ({
        ...prev,
        connected: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
    } finally {
      setLiveConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      {/* Top Bar (3-zone contract) */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F172A]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3 sm:px-6">
          <a
            href="#top"
            className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            ICT VWAP Agents
          </a>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-300">
            <a href="#chart-panel" className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              Chart
            </a>
            <a href="#agents-panel" className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              Six Agents
            </a>
            <a href="#journal-panel" className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
              Positions & Log
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                setPersisted((prev) => ({
                  ...prev,
                  theme: prev.theme === 'dark' ? 'light' : 'dark',
                }))
              }
              aria-label={`Switch to ${persisted.theme === 'dark' ? 'light' : 'dark'} theme`}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {persisted.theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
        {/* Workspace Toolbar: Pair Switcher, Feed Telemetry, Mode Switch, Kill Switch */}
        <section
          aria-label="Workspace Controls"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]"
        >
          {/* Pair Selector & Live Feed Status */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-900">
              {PAIRS.map((pairId) => {
                const avail = symbolAvailability[pairId];
                const tick = ticksByPair[pairId];
                const precision = pairId === 'frxEURUSD' ? 5 : 2;
                const active = activePair === pairId;
                return (
                  <button
                    key={pairId}
                    type="button"
                    onClick={() =>
                      setPersisted((prev) => ({ ...prev, selectedPair: pairId }))
                    }
                    className={`min-h-[38px] rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>{pairId === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'}</span>
                    <span className="ml-2 font-mono">
                      {!avail.discovered
                        ? 'Loading'
                        : !avail.available
                        ? 'Unavailable'
                        : tick
                        ? tick.quote.toFixed(precision)
                        : '—'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span
                className={`font-mono font-semibold ${
                  feedStatus === 'connected'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : feedStatus === 'down'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                Feed {feedStatus.toUpperCase()}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                Last tick:{' '}
                {lastTickEpochByPair[activePair]
                  ? `${formatNyTime(lastTickEpochByPair[activePair]!)} NY`
                  : 'Waiting'}
              </span>
              {feedStatus !== 'connected' && (
                <button
                  type="button"
                  onClick={() => publicFeedRef.current?.reconnectNow()}
                  title={feedDetail}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3 w-3" />
                  Reconnect
                </button>
              )}
            </div>
          </div>

          {/* Execution Mode Switch & Kill Switch */}
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Execution Mode"
              className="flex items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-900"
            >
              {(['paper', 'demo', 'real'] as ExecutionMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSwitch(m)}
                  className={`min-h-[38px] rounded px-3 py-1.5 text-xs font-semibold capitalize transition-colors whitespace-nowrap shrink-0 ${
                    executionMode === m
                      ? m === 'real'
                        ? 'bg-red-600 text-white'
                        : 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {m === 'paper' ? 'Paper' : m === 'demo' ? 'Demo Account' : 'Real Account'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleKillSwitchToggle}
              className={`flex min-h-[40px] items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                killSwitchEngaged
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30'
              }`}
            >
              <OctagonAlert className="h-3.5 w-3.5" />
              {killSwitchEngaged ? 'Kill Switch Active (Disarm)' : 'Kill Switch'}
            </button>
          </div>
        </section>

        {/* Disabled / Missing Symbol Banner */}
        {PAIRS.some((p) => symbolAvailability[p].discovered && !symbolAvailability[p].available) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            {PAIRS.filter((p) => symbolAvailability[p].discovered && !symbolAvailability[p].available)
              .map(
                (p) =>
                  `${p === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'}: ${
                    symbolAvailability[p].reason || 'Unavailable'
                  }`
              )
              .join(' · ')}
          </div>
        )}

        {/* KPI Stats Strip */}
        <section
          aria-label="Account and Session Summary"
          className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        >
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">Equity</div>
            <div
              data-testid="stat-equity"
              className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100"
            >
              ${totalEquity.toFixed(2)}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              Balance ${persisted.balance.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">Win Rate</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">
              {winRatePct.toFixed(1)}%
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {winsCount}W / {persisted.closedTrades.length - winsCount}L
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">Closed Trades</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">
              {persisted.closedTrades.length}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              Today PnL {persisted.dailyStats.realizedPnlUsd >= 0 ? '+' : ''}$
              {persisted.dailyStats.realizedPnlUsd.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">NY Clock & Session</div>
            <div
              data-testid="stat-ny-clock"
              className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100"
            >
              {clock.nyTimeStr}
            </div>
            <div
              className={`mt-0.5 text-[11px] font-medium ${
                clock.inSession
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {clock.sessionStateLabel}
              {clock.activeKillZone ? ` · ${clock.activeKillZone}` : ''}
            </div>
          </div>

          <div className="col-span-2 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-1 dark:border-slate-800 dark:bg-[#111827]">
            <div className="text-xs text-slate-500 dark:text-slate-400">Open Positions</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">
              {persisted.openPositions.length}
            </div>
            <div
              className={`mt-0.5 font-mono text-[11px] ${
                totalUnrealizedUsd >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              Unrealized {totalUnrealizedUsd >= 0 ? '+' : ''}${totalUnrealizedUsd.toFixed(2)}
            </div>
          </div>
        </section>

        {/* Deriv Live Execution Console (when Demo or Real is selected) */}
        <LiveExecutionPanel
          mode={executionMode}
          connected={liveConnState.connected}
          accountId={liveConnState.accountId}
          currency={liveConnState.currency}
          liveBalance={liveConnState.balance}
          connectionError={liveConnState.error}
          autoStopReason={liveAutoStopReason}
          connecting={liveConnecting}
          onConnect={handleLiveConnect}
          onDisconnect={() => liveClientRef.current?.disconnect()}
          onClearAutoStop={() => setLiveAutoStopReason(null)}
          settings={persisted.settings}
          liveGroups={persisted.liveGroups}
          liveOrderLog={liveOrderLog}
          openPositions={persisted.openPositions}
          closedTrades={persisted.closedTrades}
        />

        {/* Primary Chart + Equity Curve */}
        <section id="chart-panel" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <PriceChart
              pair={activePair}
              candles={activeCandles}
              vwapSeries={activeVwapSeries}
              atrSeries={activeAtrSeries}
              frozenRange={activeFrozenRange}
              openPosition={
                persisted.openPositions.find((p) => p.pair === activePair) ?? null
              }
              liveQuote={ticksByPair[activePair]?.quote ?? null}
              feedStatus={feedStatus}
              symbolInfo={symbolAvailability[activePair]}
              sessionStart={persisted.settings.sessionStart}
              sessionEnd={persisted.settings.sessionEnd}
            />
          </div>

          <div className="flex flex-col gap-4 xl:col-span-4">
            <EquityCurveChart
              points={persisted.equityCurve}
              startBalance={persisted.settings.startBalance}
              currentEquity={totalEquity}
            />

            {/* Pair Summary Metrics */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
              <h3 className="mb-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Pair Guard & Feed Telemetry
              </h3>
              <div className="space-y-2 text-xs">
                {PAIRS.map((p) => {
                  const t = ticksByPair[p];
                  const av = symbolAvailability[p];
                  const prec = p === 'frxEURUSD' ? 5 : 2;
                  const lastEpoch = lastTickEpochByPair[p];
                  return (
                    <div
                      key={p}
                      className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0 dark:border-slate-800/80"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {p === 'frxEURUSD' ? 'EUR/USD' : 'BTC/USD'}
                          <span className="ml-1.5 font-normal text-slate-500">
                            · {persisted.dailyStats.tradesCount[p] ?? 0}/
                            {persisted.settings.maxTradesPerPairPerDay} trades
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {av.available
                            ? lastEpoch
                              ? `Tick ${formatNyTime(lastEpoch)} NY`
                              : 'Waiting tick'
                            : av.reason || 'Disabled'}
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {t ? t.quote.toFixed(prec) : '—'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Spread {persisted.settings.pairs[p].spread}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Six Agents */}
        <div id="agents-panel">
          <AgentGrid agents={agents} />
        </div>

        {/* Open Positions, Decision Log & CSV Export */}
        <div id="journal-panel">
          <PositionsAndLogs
            openPositions={persisted.openPositions}
            closedTrades={persisted.closedTrades}
            decisionLog={persisted.decisionLog}
            onExportCsv={handleExportCsv}
            onManualClosePosition={handleManualClosePosition}
          />
        </div>
      </main>

      {/* Settings Drawer */}
      <SettingsDrawer
        open={settingsOpen}
        settings={persisted.settings}
        onChange={(nextSettings) =>
          setPersisted((prev) => ({ ...prev, settings: nextSettings }))
        }
        onResetAccount={handleResetPaperJournal}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Real Account Confirmation Modal */}
      <RealConfirmModal
        open={realModalOpen}
        onCancel={() => setRealModalOpen(false)}
        onConfirm={() => {
          setRealConfirmedThisRun(true);
          setRealModalOpen(false);
          liveClientRef.current?.disconnect();
          setExecutionMode('real');
        }}
      />
    </div>
  );
}
