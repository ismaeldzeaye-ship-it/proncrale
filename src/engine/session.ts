import { Candle, FrozenRange, SessionClockInfo } from './types';

const NY_TZ = 'America/New_York';

interface NyParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function getNyParts(epochSeconds: number): NyParts {
  const parts = nyFormatter.formatToParts(new Date(epochSeconds * 1000));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute: map.minute,
    second: map.second,
  };
}

export function formatNyDateKey(parts: NyParts): string {
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${parts.year}-${m}-${d}`;
}

export function formatNyTime(epochSeconds: number): string {
  const p = getNyParts(epochSeconds);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

export function formatNyShortTime(epochSeconds: number): string {
  const p = getNyParts(epochSeconds);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function parseHhMmToMinutes(hhmm: string, fallbackMinutes: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return fallbackMinutes;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallbackMinutes;
  return h * 60 + m;
}

/**
 * Resolves the exact UTC epoch seconds for 00:00 NY on the NY date of `epochSeconds`,
 * respecting DST automatically via Intl.DateTimeFormat.
 */
export function getNyMidnightEpoch(epochSeconds: number): number {
  const targetParts = getNyParts(epochSeconds);
  const targetKey = formatNyDateKey(targetParts);

  // Start with approximate UTC midnight for the NY calendar date
  let guess = Math.floor(Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day, 5, 0, 0) / 1000);
  // Iteratively converge using actual NY clock offset (handles EST=-5h and EDT=-4h, plus DST switch days)
  for (let i = 0; i < 4; i++) {
    const p = getNyParts(guess);
    const key = formatNyDateKey(p);
    if (key === targetKey) {
      guess -= p.hour * 3600 + p.minute * 60 + p.second;
    } else if (key < targetKey) {
      guess += 12 * 3600;
    } else {
      guess -= 12 * 3600;
    }
  }
  return guess;
}

export function getSessionClockInfo(
  epochSeconds: number,
  sessionStartStr: string,
  sessionEndStr: string
): SessionClockInfo {
  const parts = getNyParts(epochSeconds);
  const nyDateKey = formatNyDateKey(parts);
  const nyMinutes = parts.hour * 60 + parts.minute;
  const nyTimeStr = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;

  const startMins = parseHhMmToMinutes(sessionStartStr, 8 * 60);
  const endMins = parseHhMmToMinutes(sessionEndStr, 17 * 60);

  const midnightEpoch = getNyMidnightEpoch(epochSeconds);
  const sessionStartEpoch = midnightEpoch + startMins * 60;
  const sessionEndEpoch = midnightEpoch + endMins * 60;

  const inSession =
    endMins >= startMins
      ? nyMinutes >= startMins && nyMinutes < endMins
      : nyMinutes >= startMins || nyMinutes < endMins;

  let activeKillZone: SessionClockInfo['activeKillZone'] = null;
  if (nyMinutes >= 7 * 60 && nyMinutes < 10 * 60) {
    activeKillZone = 'London-NY AM (07:00-10:00)';
  } else if (nyMinutes >= 13 * 60 + 30 && nyMinutes < 16 * 60) {
    activeKillZone = 'NY PM (13:30-16:00)';
  }

  let sessionStateLabel: SessionClockInfo['sessionStateLabel'] = 'PRE-SESSION';
  if (inSession) {
    sessionStateLabel = 'IN SESSION';
  } else if (nyMinutes >= endMins) {
    sessionStateLabel = 'POST-SESSION';
  }

  return {
    nyDateKey,
    nyTimeStr,
    nyMinutes,
    midnightEpoch,
    sessionStartEpoch,
    sessionEndEpoch,
    inSession,
    activeKillZone,
    sessionStateLabel,
  };
}

/**
 * Computes the Asia+London range (00:00 NY up to sessionStart) from 5m candles.
 * Freezes once current time reaches sessionStart.
 */
export function computeAsiaLondonRange(
  candles: Candle[],
  clock: SessionClockInfo
): FrozenRange | null {
  const rangeCandles = candles.filter(
    (c) => c.epoch >= clock.midnightEpoch && c.epoch < clock.sessionStartEpoch
  );
  if (rangeCandles.length === 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const c of rangeCandles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }

  const frozen = clock.nyMinutes >= Math.floor((clock.sessionStartEpoch - clock.midnightEpoch) / 60);

  return {
    nyDateKey: clock.nyDateKey,
    high,
    low,
    frozen,
    candleCount: rangeCandles.length,
  };
}
