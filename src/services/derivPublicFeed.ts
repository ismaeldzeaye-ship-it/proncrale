import {
  Candle,
  FeedStatus,
  PairId,
  SymbolAvailability,
  TickData,
} from '../engine/types';

export interface PublicFeedCallbacks {
  onStatusChange: (status: FeedStatus, detail?: string) => void;
  onSymbolsResolved: (availability: Record<PairId, SymbolAvailability>) => void;
  onCandlesSnapshot: (pair: PairId, candles: Candle[]) => void;
  onCandleUpdate: (pair: PairId, candle: Candle, closedPrevCandle: Candle | null) => void;
  onTick: (tick: TickData) => void;
}

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const TARGET_PAIRS: PairId[] = ['frxEURUSD', 'cryBTCUSD'];

export class DerivPublicFeed {
  private ws: WebSocket | null = null;
  private callbacks: PublicFeedCallbacks;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private symbolsRetryTimer: number | null = null;
  private symbolsResolved = false;
  private reqCounter = 1;
  private availability: Record<PairId, SymbolAvailability>;
  private candlesByPair: Record<PairId, Candle[]> = {
    frxEURUSD: [],
    cryBTCUSD: [],
  };

  constructor(
    initialAvailability: Record<PairId, SymbolAvailability>,
    callbacks: PublicFeedCallbacks
  ) {
    this.availability = {
      frxEURUSD: { ...initialAvailability.frxEURUSD },
      cryBTCUSD: { ...initialAvailability.cryBTCUSD },
    };
    this.callbacks = callbacks;
  }

  public start(): void {
    this.destroyed = false;
    this.connect();
  }

  public stop(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onStatusChange('down', 'Feed stopped.');
  }

  public reconnectNow(): void {
    if (this.destroyed) return;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.symbolsRetryTimer !== null) {
      window.clearTimeout(this.symbolsRetryTimer);
      this.symbolsRetryTimer = null;
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...payload, req_id: this.reqCounter++ }));
    }
  }

  private requestSymbolsWithWatchdog(): void {
    if (this.destroyed || this.symbolsResolved) return;
    this.send({ active_symbols: 'brief' });
    if (this.symbolsRetryTimer !== null) {
      window.clearTimeout(this.symbolsRetryTimer);
    }
    this.symbolsRetryTimer = window.setTimeout(() => {
      if (!this.destroyed && !this.symbolsResolved) {
        this.requestSymbolsWithWatchdog();
      }
    }, 3000);
  }

  private connect(): void {
    if (this.destroyed) return;
    this.symbolsResolved = false;
    this.callbacks.onStatusChange(
      this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
      'Connecting to Deriv public options stream...'
    );

    try {
      const ws = new WebSocket(PUBLIC_WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        if (this.destroyed) return;
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange('connected', 'Connected to Deriv public stream');

        // 1. Discover active symbols (with automatic retry if rate-limited or delayed)
        this.requestSymbolsWithWatchdog();

        // 2. Heartbeat ping every 25s
        this.pingTimer = window.setInterval(() => {
          this.send({ ping: 1 });
        }, 25000);
      };

      ws.onmessage = (event) => {
        if (this.destroyed) return;
        try {
          const msg = JSON.parse(event.data as string);
          this.handleMessage(msg);
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        if (this.destroyed) return;
        this.callbacks.onStatusChange('down', 'WebSocket transport error');
      };

      ws.onclose = () => {
        if (this.destroyed) return;
        this.clearTimers();
        this.callbacks.onStatusChange('reconnecting', 'Stream closed; reconnecting...');
        this.scheduleReconnect();
      };
    } catch {
      this.callbacks.onStatusChange('down', 'Failed to initialize WebSocket');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delayMs = Math.min(15000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const msgType = msg.msg_type as string | undefined;
    if (!msgType || msgType === 'ping' || msgType === 'pong') return;

    if (msg.error) {
      const errObj = msg.error as Record<string, unknown>;
      const code = String(errObj.code || '');
      if (msgType === 'active_symbols' && !this.symbolsResolved) {
        if (this.symbolsRetryTimer !== null) window.clearTimeout(this.symbolsRetryTimer);
        this.symbolsRetryTimer = window.setTimeout(() => {
          this.requestSymbolsWithWatchdog();
        }, code === 'RateLimit' ? 2500 : 3500);
      } else if (msgType === 'contracts_for' && code === 'RateLimit') {
        const sym = (msg.echo_req as Record<string, unknown> | undefined)?.contracts_for as
          | PairId
          | undefined;
        if (sym && TARGET_PAIRS.includes(sym)) {
          window.setTimeout(() => this.send({ contracts_for: sym }), 3000);
        }
      }
      return;
    }

    if (msgType === 'active_symbols' && Array.isArray(msg.active_symbols)) {
      this.symbolsResolved = true;
      if (this.symbolsRetryTimer !== null) {
        window.clearTimeout(this.symbolsRetryTimer);
        this.symbolsRetryTimer = null;
      }
      const list = msg.active_symbols as Array<Record<string, unknown>>;
      for (const pair of TARGET_PAIRS) {
        const match = list.find(
          (item) => (item.underlying_symbol || item.symbol) === pair
        );
        if (!match) {
          this.availability[pair] = {
            ...this.availability[pair],
            discovered: true,
            available: false,
            reason: `${pair} missing from Deriv active_symbols.`,
          };
        } else {
          const exchangeOpen = Number(match.exchange_is_open ?? 1) === 1;
          const suspended = Number(match.is_trading_suspended ?? 0) === 1;
          const available = exchangeOpen && !suspended;
          let reason: string | undefined;
          if (!exchangeOpen) reason = `${pair} exchange is closed.`;
          if (suspended) reason = `${pair} trading is suspended.`;

          this.availability[pair] = {
            ...this.availability[pair],
            discovered: true,
            displayName: String(match.underlying_symbol_name || match.display_name || this.availability[pair].displayName),
            available,
            exchangeIsOpen: exchangeOpen,
            isSuspended: suspended,
            reason,
            pipSize: Number(match.pip_size ?? this.availability[pair].pipSize),
          };
        }
      }

      this.callbacks.onSymbolsResolved({
        frxEURUSD: { ...this.availability.frxEURUSD },
        cryBTCUSD: { ...this.availability.cryBTCUSD },
      });

      // Subscribe candles + ticks for available symbols
      TARGET_PAIRS.forEach((pair, idx) => {
        if (!this.availability[pair].available) return;
        this.send({
          ticks_history: pair,
          end: 'latest',
          count: 420,
          style: 'candles',
          granularity: 300,
          subscribe: 1,
        });
        this.send({
          ticks: pair,
          subscribe: 1,
        });
        // Stagger contracts_for to stay well under Deriv's per-endpoint rate limit
        window.setTimeout(() => {
          this.send({ contracts_for: pair });
        }, 600 + idx * 1400);
      });
      return;
    }

    if (msgType === 'contracts_for' && msg.contracts_for) {
      const cf = msg.contracts_for as { available?: Array<Record<string, unknown>> };
      const available = cf.available || [];
      const multEntry = available.find(
        (c) => c.contract_category === 'multiplier' || String(c.contract_type).includes('MULT')
      );
      const pair = (multEntry?.underlying_symbol ||
        (msg.echo_req as Record<string, unknown> | undefined)?.contracts_for) as PairId | undefined;
      if (pair && (pair === 'frxEURUSD' || pair === 'cryBTCUSD') && multEntry) {
        const range = Array.isArray(multEntry.multiplier_range)
          ? multEntry.multiplier_range.map((n) => Number(n)).filter((n) => Number.isFinite(n))
          : this.availability[pair].multipliers;
        this.availability[pair] = {
          ...this.availability[pair],
          multipliers: range.length > 0 ? range : this.availability[pair].multipliers,
          minStake: Number(multEntry.min_stake ?? 1),
          maxStake: Number(multEntry.max_stake ?? 2000),
        };
        this.callbacks.onSymbolsResolved({
          frxEURUSD: { ...this.availability.frxEURUSD },
          cryBTCUSD: { ...this.availability.cryBTCUSD },
        });
      }
      return;
    }

    if (msgType === 'candles' && Array.isArray(msg.candles)) {
      const echo = msg.echo_req as Record<string, unknown> | undefined;
      const pair = echo?.ticks_history as PairId | undefined;
      if (!pair || !TARGET_PAIRS.includes(pair)) return;

      const existingMap = new Map<number, Candle>();
      for (const old of this.candlesByPair[pair]) {
        existingMap.set(old.epoch, old);
      }

      const rawCandles = msg.candles as Array<Record<string, unknown>>;
      const parsed: Candle[] = rawCandles
        .map((c) => {
          const epoch = Number(c.epoch);
          const prev = existingMap.get(epoch);
          const vol = c.volume !== undefined ? Number(c.volume) : undefined;
          return {
            epoch,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            tickCount: prev ? Math.max(prev.tickCount, 1) : 1,
            volume: vol && Number.isFinite(vol) ? vol : undefined,
          };
        })
        .sort((a, b) => a.epoch - b.epoch);

      this.candlesByPair[pair] = parsed;
      this.callbacks.onCandlesSnapshot(pair, [...parsed]);
      return;
    }

    if (msgType === 'ohlc' && msg.ohlc) {
      const ohlc = msg.ohlc as Record<string, unknown>;
      const pair = ohlc.symbol as PairId | undefined;
      if (!pair || !TARGET_PAIRS.includes(pair)) return;

      const openTime = Number(ohlc.open_time);
      const list = this.candlesByPair[pair];
      const last = list[list.length - 1];

      if (last && last.epoch === openTime) {
        const updated: Candle = {
          ...last,
          open: Number(ohlc.open),
          high: Number(ohlc.high),
          low: Number(ohlc.low),
          close: Number(ohlc.close),
        };
        list[list.length - 1] = updated;
        this.callbacks.onCandleUpdate(pair, updated, null);
      } else if (!last || openTime > last.epoch) {
        const closedPrev = last ? { ...last } : null;
        const nextCandle: Candle = {
          epoch: openTime,
          open: Number(ohlc.open),
          high: Number(ohlc.high),
          low: Number(ohlc.low),
          close: Number(ohlc.close),
          tickCount: 1,
        };
        const trimmed = list.length > 500 ? list.slice(-499) : [...list];
        trimmed.push(nextCandle);
        this.candlesByPair[pair] = trimmed;
        this.callbacks.onCandleUpdate(pair, nextCandle, closedPrev);
      }
      return;
    }

    if (msgType === 'tick' && msg.tick) {
      const t = msg.tick as Record<string, unknown>;
      const pair = t.symbol as PairId | undefined;
      if (!pair || !TARGET_PAIRS.includes(pair)) return;

      const epoch = Number(t.epoch);
      const quote = Number(t.quote);
      const bid = Number(t.bid ?? quote);
      const ask = Number(t.ask ?? quote);
      const pipSize = Number(t.pip_size ?? 5);

      // Increment tick count on the corresponding 5m bucket for VWAP volume
      const bucketEpoch = Math.floor(epoch / 300) * 300;
      const list = this.candlesByPair[pair];
      const bucket = list.find((c) => c.epoch === bucketEpoch);
      if (bucket) {
        bucket.tickCount += 1;
      }

      this.callbacks.onTick({
        symbol: pair,
        quote,
        bid,
        ask,
        epoch,
        pipSize,
      });
    }
  }
}
