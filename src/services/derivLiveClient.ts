import {
  AppSettings,
  Direction,
  LiveContractLeg,
  LiveExecutionGroup,
  LiveOrderLogEntry,
  PairId,
  SymbolAvailability,
} from '../engine/types';
import { computeMultiplierOrderPlan } from '../engine/derivMultiplier';
import { formatNyTime } from '../engine/session';

export interface DerivAccountSummary {
  accountId: string;
  accountType: 'demo' | 'real';
  currency: string;
  balance?: number;
}

export interface LiveClientCallbacks {
  onConnectionChange: (status: {
    connected: boolean;
    mode: 'demo' | 'real' | null;
    accountId: string | null;
    currency: string;
    balance: number | null;
    error: string | null;
  }) => void;
  onOrderLog: (entry: LiveOrderLogEntry) => void;
  onGroupUpdate: (group: LiveExecutionGroup) => void;
  onAutoStop: (reason: string) => void;
}

const DERIV_API_BASE = 'https://api.derivws.com';

interface PendingRpc {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: number;
}

export class DerivLiveClient {
  private ws: WebSocket | null = null;
  private callbacks: LiveClientCallbacks;
  private mode: 'demo' | 'real' | null = null;
  private accountId: string | null = null;
  private currency = 'USD';
  private balance: number | null = null;
  private reqId = 1;
  private pending = new Map<number, PendingRpc>();
  private pingTimer: number | null = null;
  private consecutiveRejections = 0;
  private groups = new Map<string, LiveExecutionGroup>();
  private contractToGroup = new Map<number, string>();

  constructor(callbacks: LiveClientCallbacks) {
    this.callbacks = callbacks;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getBalance(): number | null {
    return this.balance;
  }

  public getOpenContractCount(): number {
    let count = 0;
    for (const g of this.groups.values()) {
      for (const leg of g.legs) {
        if (!leg.isSold && leg.status === 'open') count += 1;
      }
    }
    return count;
  }

  public disconnect(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const p of this.pending.values()) {
      window.clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.mode = null;
    this.accountId = null;
    this.balance = null;
    this.consecutiveRejections = 0;
    this.callbacks.onConnectionChange({
      connected: false,
      mode: null,
      accountId: null,
      currency: 'USD',
      balance: null,
      error: null,
    });
  }

  private logOrder(
    mode: 'demo' | 'real',
    pair: PairId,
    action: LiveOrderLogEntry['action'],
    requestSummary: string,
    responseSummary: string,
    ok: boolean
  ): void {
    this.callbacks.onOrderLog({
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: formatNyTime(Math.floor(Date.now() / 1000)),
      mode,
      pair,
      action,
      requestSummary,
      responseSummary,
      ok,
    });
  }

  /**
   * Authenticates using Deriv's One-Time-Token (OTP) flow:
   * 1. GET /trading/v1/options/accounts (Authorization: Bearer <in-memory-token>)
   * 2. POST /trading/v1/options/accounts/{accountId}/otp
   * 3. Connect to returned wss://api.derivws.com/trading/v1/options/ws/{demo|real}?otp=...
   * Note: Token is never persisted, never logged, never stored in code.
   */
  public async connectWithToken(params: {
    mode: 'demo' | 'real';
    token: string;
    appId?: string;
    preferredAccountId?: string;
  }): Promise<void> {
    this.disconnect();
    const { mode, token, appId, preferredAccountId } = params;
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error('Deriv API token is required (held in memory only).');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${trimmedToken}`,
      'Content-Type': 'application/json',
    };
    if (appId && appId.trim()) {
      headers['Deriv-App-ID'] = appId.trim();
    }

    let selectedAccountId = preferredAccountId?.trim() || '';
    let currency = 'USD';

    // Step 1: Discover options accounts if account ID wasn't explicitly supplied
    const accountsRes = await fetch(`${DERIV_API_BASE}/trading/v1/options/accounts`, {
      method: 'GET',
      headers,
    });
    const accountsJson = (await accountsRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!accountsRes.ok) {
      const msg =
        (accountsJson.message as string) ||
        ((accountsJson.error as Record<string, unknown>)?.message as string) ||
        `HTTP ${accountsRes.status} reading options accounts`;
      this.logOrder(mode, 'frxEURUSD', 'OTP', 'GET /trading/v1/options/accounts', msg, false);
      throw new Error(msg);
    }

    const rawList = Array.isArray(accountsJson.data)
      ? (accountsJson.data as Array<Record<string, unknown>>)
      : Array.isArray(accountsJson.accounts)
      ? (accountsJson.accounts as Array<Record<string, unknown>>)
      : [];

    if (!selectedAccountId) {
      const matching = rawList.find((acc) => {
        const typeStr = String(acc.account_type || acc.type || '').toLowerCase();
        const idStr = String(acc.account_id || acc.id || '');
        if (mode === 'demo') {
          return typeStr === 'demo' || typeStr === 'virtual' || idStr.toUpperCase().includes('VR') || idStr.toUpperCase().includes('DOT');
        }
        return typeStr === 'real' || (!typeStr.includes('demo') && !typeStr.includes('virtual'));
      });
      const chosen = matching || rawList[0];
      if (!chosen) {
        throw new Error(`No ${mode} options account found for this token.`);
      }
      selectedAccountId = String(chosen.account_id || chosen.id || '');
      currency = String(chosen.currency || 'USD');
    }

    // Step 2: Request single-use OTP WebSocket URL
    const otpRes = await fetch(
      `${DERIV_API_BASE}/trading/v1/options/accounts/${encodeURIComponent(selectedAccountId)}/otp`,
      {
        method: 'POST',
        headers,
      }
    );
    const otpJson = (await otpRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!otpRes.ok) {
      const msg =
        (otpJson.message as string) ||
        ((otpJson.error as Record<string, unknown>)?.message as string) ||
        `HTTP ${otpRes.status} generating OTP`;
      this.logOrder(
        mode,
        'frxEURUSD',
        'OTP',
        `POST /trading/v1/options/accounts/${selectedAccountId}/otp`,
        msg,
        false
      );
      throw new Error(msg);
    }

    const dataObj = (otpJson.data as Record<string, unknown> | undefined) || otpJson;
    let wsUrl = String(dataObj.url || '');
    const otpCode = String(dataObj.otp || '');
    if (!wsUrl && otpCode) {
      wsUrl = `wss://api.derivws.com/trading/v1/options/ws/${mode}?otp=${encodeURIComponent(otpCode)}`;
    }
    if (!wsUrl) {
      throw new Error('OTP endpoint did not return a WebSocket URL.');
    }

    // Enforce demo gateway for Demo and real gateway for Real
    const expectedSegment = mode === 'demo' ? '/ws/demo' : '/ws/real';
    if (!wsUrl.includes(expectedSegment)) {
      throw new Error(
        `Gateway mismatch: expected ${expectedSegment} for ${mode} mode, received different endpoint.`
      );
    }

    this.logOrder(
      mode,
      'frxEURUSD',
      'OTP',
      `POST /trading/v1/options/accounts/${selectedAccountId}/otp`,
      `OTP issued for ${selectedAccountId} (${expectedSegment})`,
      true
    );

    // Step 3: Connect authenticated WebSocket
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      this.mode = mode;
      this.accountId = selectedAccountId;
      this.currency = currency;

      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out connecting to Deriv account WebSocket.'));
      }, 10000);

      ws.onopen = async () => {
        window.clearTimeout(timeout);
        this.pingTimer = window.setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ping: 1 }));
          }
        }, 25000);

        try {
          const balRes = await this.rpc({ balance: 1, subscribe: 1 });
          const balObj = balRes.balance as Record<string, unknown> | undefined;
          if (!balObj || balObj.balance === undefined) {
            throw new Error('Missing balance field in Deriv balance response.');
          }
          const balVal = Number(balObj.balance);
          this.balance = balVal;
          this.currency = String(balObj.currency || currency);
          this.logOrder(
            mode,
            'frxEURUSD',
            'BALANCE',
            'balance: 1 (subscribe)',
            `${this.currency} ${balVal.toFixed(2)}`,
            true
          );
          this.callbacks.onConnectionChange({
            connected: true,
            mode,
            accountId: selectedAccountId,
            currency: this.currency,
            balance: balVal,
            error: null,
          });
          resolve();
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'Balance read failure';
          this.logOrder(mode, 'frxEURUSD', 'BALANCE', 'balance: 1', reason, false);
          this.callbacks.onAutoStop(`Balance read failure: ${reason}`);
          reject(err instanceof Error ? err : new Error(reason));
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
          this.handleWsMessage(msg);
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('WebSocket error on Deriv account gateway.'));
      };

      ws.onclose = () => {
        const wasConnected = this.mode !== null;
        this.ws = null;
        if (this.pingTimer !== null) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (wasConnected) {
          this.callbacks.onConnectionChange({
            connected: false,
            mode: this.mode,
            accountId: this.accountId,
            currency: this.currency,
            balance: this.balance,
            error: 'Account WebSocket closed.',
          });
        }
      };
    });
  }

  private rpc(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Deriv account WebSocket is not connected.'));
        return;
      }
      const id = this.reqId++;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Deriv RPC timeout'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  private handleWsMessage(msg: Record<string, unknown>): void {
    const reqId = typeof msg.req_id === 'number' ? msg.req_id : null;
    if (reqId !== null && this.pending.has(reqId)) {
      const p = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      window.clearTimeout(p.timer);
      if (msg.error) {
        const errObj = msg.error as Record<string, unknown>;
        p.reject(new Error(String(errObj.message || errObj.code || 'Deriv RPC error')));
      } else {
        p.resolve(msg);
      }
    }

    if (msg.msg_type === 'balance' && msg.balance && this.mode) {
      const b = msg.balance as Record<string, unknown>;
      const val = Number(b.balance);
      if (Number.isFinite(val)) {
        this.balance = val;
        this.callbacks.onConnectionChange({
          connected: this.isConnected(),
          mode: this.mode,
          accountId: this.accountId,
          currency: String(b.currency || this.currency),
          balance: val,
          error: null,
        });
      }
    }

    if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
      this.handleOpenContractUpdate(msg.proposal_open_contract as Record<string, unknown>);
    }
  }

  private async handleOpenContractUpdate(poc: Record<string, unknown>): Promise<void> {
    const contractId = Number(poc.contract_id);
    const groupId = this.contractToGroup.get(contractId);
    if (!groupId) return;
    const group = this.groups.get(groupId);
    if (!group) return;

    const legIdx = group.legs.findIndex((l) => l.contractId === contractId);
    if (legIdx === -1) return;

    const leg = { ...group.legs[legIdx] };
    leg.entrySpot = poc.entry_spot !== undefined ? Number(poc.entry_spot) : leg.entrySpot;
    leg.currentSpot = poc.current_spot !== undefined ? Number(poc.current_spot) : leg.currentSpot;
    leg.profit = poc.profit !== undefined ? Number(poc.profit) : leg.profit;
    leg.isSold = Number(poc.is_sold ?? 0) === 1;
    const statusStr = String(poc.status || 'open');
    leg.status =
      statusStr === 'won'
        ? 'won'
        : statusStr === 'lost'
        ? 'lost'
        : leg.isSold
        ? 'sold'
        : 'open';

    const nextLegs = [...group.legs];
    nextLegs[legIdx] = leg;

    const updatedGroup: LiveExecutionGroup = {
      ...group,
      legs: nextLegs,
      liveActualEntry: group.liveActualEntry ?? leg.entrySpot,
      totalLivePnl: nextLegs.reduce((acc, l) => acc + l.profit, 0),
      status: nextLegs.every((l) => l.isSold) ? 'closed' : 'open',
    };
    this.groups.set(groupId, updatedGroup);
    this.callbacks.onGroupUpdate(updatedGroup);

    // If Leg 0 (50% @ 2R) closed in profit, move the other two legs' stop_loss to break-even
    if (legIdx === 0 && leg.isSold && leg.profit > 0) {
      for (let i = 1; i < updatedGroup.legs.length; i++) {
        const other = updatedGroup.legs[i];
        if (!other.isSold && !other.breakEvenMoved) {
          other.breakEvenMoved = true;
          try {
            await this.rpc({
              contract_update: 1,
              contract_id: other.contractId,
              limit_order: { stop_loss: 0.01 },
            });
            this.logOrder(
              updatedGroup.mode,
              updatedGroup.pair,
              'CONTRACT_UPDATE',
              `contract_update ${other.contractId} SL -> BE ($0.01)`,
              'Stop moved to break-even',
              true
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'contract_update failed';
            this.logOrder(
              updatedGroup.mode,
              updatedGroup.pair,
              'CONTRACT_UPDATE',
              `contract_update ${other.contractId} SL -> BE`,
              msg,
              false
            );
          }
        }
      }
    }
  }

  public async executeLadderTrade(params: {
    mode: 'demo' | 'real';
    paperTradeId: string;
    pair: PairId;
    direction: Direction;
    entryPrice: number;
    stopDistance: number;
    riskUsd: number;
    symbolInfo: SymbolAvailability;
    settings: AppSettings;
    dailyLiveTrades: number;
    dailyLivePnlUsd: number;
  }): Promise<LiveExecutionGroup | null> {
    const {
      mode,
      paperTradeId,
      pair,
      direction,
      entryPrice,
      stopDistance,
      riskUsd,
      symbolInfo,
      settings,
      dailyLiveTrades,
      dailyLivePnlUsd,
    } = params;

    if (!this.isConnected()) {
      this.logOrder(mode, pair, 'AUTO_STOP', 'executeLadderTrade', 'Account WS disconnected.', false);
      return null;
    }

    if (this.balance === null) {
      this.callbacks.onAutoStop('Balance read failure before execution.');
      return null;
    }

    // Hard caps check
    if (dailyLiveTrades >= settings.liveMaxTradesPerDay) {
      this.logOrder(
        mode,
        pair,
        'PROPOSAL',
        'Hard cap check',
        `Blocked: liveMaxTradesPerDay (${settings.liveMaxTradesPerDay}) reached.`,
        false
      );
      return null;
    }

    const liveLossLimit = -(this.balance * (settings.liveDailyLossCapPct / 100));
    if (dailyLivePnlUsd <= liveLossLimit) {
      this.logOrder(
        mode,
        pair,
        'PROPOSAL',
        'Hard cap check',
        `Blocked: live daily loss cap (${settings.liveDailyLossCapPct}%) reached.`,
        false
      );
      return null;
    }

    if (this.getOpenContractCount() + 3 > settings.maxOpenContracts) {
      this.logOrder(
        mode,
        pair,
        'PROPOSAL',
        'Hard cap check',
        `Blocked: maxOpenContracts (${settings.maxOpenContracts}) would be exceeded.`,
        false
      );
      return null;
    }

    const plan = computeMultiplierOrderPlan({
      symbol: pair,
      direction,
      entryPrice,
      stopDistance,
      riskUsd,
      availableMultipliers: symbolInfo.multipliers,
      minStake: symbolInfo.minStake,
      maxStake: symbolInfo.maxStake,
      maxStakeCap: settings.maxStakePerTrade,
      partial1R: settings.partial1R,
      partial1Pct: settings.partial1Pct,
      partial2R: settings.partial2R,
      partial2Pct: settings.partial2Pct,
    });

    if (!plan.valid) {
      this.logOrder(mode, pair, 'PROPOSAL', 'Multiplier sizing', `Skipped: ${plan.reason}`, false);
      return null;
    }

    const legs: LiveContractLeg[] = [];

    for (const legPlan of plan.legs) {
      const limitOrder: Record<string, number> = {
        stop_loss: legPlan.stopLossUsd,
      };
      if (legPlan.takeProfitUsd !== null) {
        limitOrder.take_profit = legPlan.takeProfitUsd;
      }

      const proposalReq = {
        proposal: 1,
        amount: legPlan.stake,
        basis: 'stake',
        contract_type: plan.contractType,
        currency: this.currency,
        symbol: pair,
        multiplier: plan.multiplier,
        limit_order: limitOrder,
      };

      try {
        const propRes = await this.rpc(proposalReq);
        const prop = propRes.proposal as Record<string, unknown> | undefined;
        if (!prop?.id) {
          throw new Error('Proposal missing id');
        }
        const askPrice = Number(prop.ask_price ?? legPlan.stake);
        this.logOrder(
          mode,
          pair,
          'PROPOSAL',
          `${legPlan.legLabel}: ${plan.contractType} x${plan.multiplier} $${legPlan.stake} (SL $${legPlan.stopLossUsd}${legPlan.takeProfitUsd ? `, TP $${legPlan.takeProfitUsd}` : ''})`,
          `Proposal ${prop.id} @ $${askPrice}`,
          true
        );

        const buyRes = await this.rpc({ buy: prop.id, price: askPrice });
        const buyObj = buyRes.buy as Record<string, unknown> | undefined;
        if (!buyObj?.contract_id) {
          throw new Error('Buy response missing contract_id');
        }
        const contractId = Number(buyObj.contract_id);
        this.consecutiveRejections = 0;

        this.logOrder(
          mode,
          pair,
          'BUY',
          `buy ${prop.id} @ $${askPrice}`,
          `Filled contract #${contractId} @ $${Number(buyObj.buy_price ?? askPrice)}`,
          true
        );

        legs.push({
          contractId,
          legLabel: legPlan.legLabel,
          stake: legPlan.stake,
          multiplier: plan.multiplier,
          buyPrice: Number(buyObj.buy_price ?? askPrice),
          profit: 0,
          status: 'open',
          isSold: false,
          takeProfitUsd: legPlan.takeProfitUsd,
          stopLossUsd: legPlan.stopLossUsd,
        });

        // Subscribe to real fills via proposal_open_contract
        this.rpc({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1,
        }).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Order rejected';
        this.consecutiveRejections += 1;
        this.logOrder(
          mode,
          pair,
          'BUY',
          `${legPlan.legLabel} ${plan.contractType} x${plan.multiplier} $${legPlan.stake}`,
          `Rejected (${this.consecutiveRejections}/2): ${msg}`,
          false
        );

        if (this.consecutiveRejections >= 2) {
          this.callbacks.onAutoStop('Two rejected orders in a row.');
          this.logOrder(
            mode,
            pair,
            'AUTO_STOP',
            'Auto-stop monitor',
            'Engaged auto-stop after 2 consecutive order rejections.',
            false
          );
          break;
        }
      }
    }

    if (legs.length === 0) return null;

    const groupId = `live-grp-${Date.now()}`;
    const group: LiveExecutionGroup = {
      id: groupId,
      paperTradeId,
      pair,
      mode,
      direction,
      openedAtEpoch: Math.floor(Date.now() / 1000),
      paperExpectedEntry: entryPrice,
      legs,
      totalStake: legs.reduce((s, l) => s + l.stake, 0),
      totalLivePnl: 0,
      status: 'open',
    };

    this.groups.set(groupId, group);
    for (const l of legs) {
      this.contractToGroup.set(l.contractId, groupId);
    }
    this.callbacks.onGroupUpdate(group);
    return group;
  }

  public async closeAllOpenContracts(reason: string): Promise<void> {
    if (!this.isConnected()) return;
    for (const group of this.groups.values()) {
      for (const leg of group.legs) {
        if (!leg.isSold && leg.status === 'open') {
          try {
            const res = await this.rpc({ sell: leg.contractId, price: 0 });
            const sellObj = res.sell as Record<string, unknown> | undefined;
            this.logOrder(
              group.mode,
              group.pair,
              'SELL',
              `sell #${leg.contractId} (${reason})`,
              `Sold @ $${Number(sellObj?.sold_for ?? 0).toFixed(2)}`,
              true
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'sell failed';
            this.logOrder(
              group.mode,
              group.pair,
              'SELL',
              `sell #${leg.contractId} (${reason})`,
              msg,
              false
            );
          }
        }
      }
    }
  }
}
