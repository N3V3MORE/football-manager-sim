// ─── Premier League Calendar ──────────────────────────────────────────────────
// Season 2024/25 starts on Sat 10 Aug 2024.
// Week numbers are simulation slots; fixtures can carry date ordinals so midweek
// league/cup matches can share the same numbered week without moving dates back.
//
// ⚠️ IMPORTANT: All date-formatting functions accept an optional `season` parameter
// (defaults to 1). Callers MUST pass the current season number to ensure dates
// increment correctly across year boundaries. UI callers that omit `season` will
// display incorrect dates after season 1. Phase 8 tracks the UI sweep for this.

import { ENGINE_CONFIG } from '../config/engineConfig';
import type { Fixture } from '../models/types';

export const SEASON_START = new Date(2024, 7, 10); // Aug 10 2024
export const WINTER_WINDOW_OPEN_ORDINAL = 144; // 1 Jan 2025 in season one
export const LEAGUE_END_ORDINAL = 288; // 25 May 2025 in season one
export const SEASON_FINAL_ORDINAL = 309; // Leaves roughly eight off-season weeks

const getSeasonStart = (season = 1) => new Date(2024 + Math.max(0, season - 1), 7, 10);

export const dateOrdinalToWeek = (dateOrdinal: number): number => Math.floor(Math.max(0, dateOrdinal) / 7) + 1;

export const weekToDateOrdinal = (week: number): number => {
  const normalizedWeek = Math.max(1, week);
  return (normalizedWeek - 1) * 7;
};

export const dateOrdinalToDate = (dateOrdinal: number, season = 1): Date => {
  const d = getSeasonStart(season);
  d.setDate(d.getDate() + Math.max(0, Math.round(dateOrdinal)));
  return d;
};

/**
 * Returns a formatted season label like "2024/25 Fixtures".
 * @param season - Season number (1 = 2024/25, 2 = 2025/26, etc.)
 */
export const formatSeasonLabel = (season = 1): string => {
  const startYear = 2024 + Math.max(0, season - 1);
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')} Fixtures`;
};

/**
 * Returns a JS Date for the given matchweek.
 * @param week - Matchweek number (1-based).
 * @param season - Season number (1 = 2024/25, 2 = 2025/26, etc.). Must be passed for correct year-boundary display.
 */
export const weekToDate = (week: number, season = 1): Date => {
  return dateOrdinalToDate(weekToDateOrdinal(week), season);
};

export const fixtureToDate = (fixture: Pick<Fixture, 'week' | 'dateOrdinal'>, season = 1): Date => (
  dateOrdinalToDate(fixture.dateOrdinal ?? weekToDateOrdinal(fixture.week), season)
);

/**
 * Returns a short human-readable date string e.g. "Sat 10 Aug"
 */
export const formatMatchDate = (week: number, season = 1): string => {
  return weekToDate(week, season).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Returns just the date portion e.g. "10 Aug"
 */
export const formatShortDate = (week: number, season = 1): string => {
  return weekToDate(week, season).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
};

export const formatFixtureShortDate = (fixture: Pick<Fixture, 'week' | 'dateOrdinal'>, season = 1): string => {
  return fixtureToDate(fixture, season).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Returns the full month/year for section headers e.g. "August 2024"
 */
export const formatMonthYear = (week: number, season = 1): string => {
  return weekToDate(week, season).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
};

// ─── Transfer Windows (2024/25 real PL dates) ─────────────────────────────────
// Summer:  1 Jun → 30 Aug 2024  ≈ weeks 1–4 (window opens pre-season, closes Fri 30 Aug)
// Winter:  1 Jan → 3 Feb 2025  ≈ weeks 19–24

/** Approximately which week the Summer window closes */
export const SUMMER_WINDOW_CLOSE_WEEK = dateOrdinalToWeek(20);

/** Approximately which week the Winter window opens and closes */
export const WINTER_WINDOW_OPEN_WEEK = dateOrdinalToWeek(WINTER_WINDOW_OPEN_ORDINAL);
export const WINTER_WINDOW_CLOSE_WEEK = dateOrdinalToWeek(177);

export type WindowStatus =
  | 'summer_open'
  | 'winter_open'
  | 'closed';

/**
 * Returns the current transfer window status for a given week.
 */
export const getWindowStatus = (week: number): WindowStatus => {
  if (week >= 1 && week <= SUMMER_WINDOW_CLOSE_WEEK) return 'summer_open';
  if (week >= WINTER_WINDOW_OPEN_WEEK && week <= WINTER_WINDOW_CLOSE_WEEK) return 'winter_open';
  return 'closed';
};

/**
 * Returns true if transfers are permitted this week.
 */
export const isTransferWindowOpen = (week: number): boolean =>
  getWindowStatus(week) !== 'closed';

/**
 * Returns a human-readable banner string for the window status.
 * e.g. "Summer Window Open — Closes 1 Sep" or "Transfer Window Closed"
 */
export const getTransferWindowLabel = (week: number, season = 1): string => {
  const status = getWindowStatus(week);
  if (status === 'summer_open') {
    const weeksLeft = SUMMER_WINDOW_CLOSE_WEEK - week;
    const closeDate = formatShortDate(SUMMER_WINDOW_CLOSE_WEEK + 1, season);
    return weeksLeft === 0
      ? `Summer Window — Closes ${closeDate}`
      : `Summer Window Open — ${weeksLeft} week${weeksLeft !== 1 ? 's' : ''} left`;
  }
  if (status === 'winter_open') {
    const weeksLeft = WINTER_WINDOW_CLOSE_WEEK - week;
    const closeDate = formatShortDate(WINTER_WINDOW_CLOSE_WEEK + 1, season);
    return weeksLeft === 0
      ? `Winter Window — Closes ${closeDate}`
      : `Winter Window Open — ${weeksLeft} week${weeksLeft !== 1 ? 's' : ''} left`;
  }
  // Next window
  if (week < WINTER_WINDOW_OPEN_WEEK) {
    const weeksUntil = WINTER_WINDOW_OPEN_WEEK - week;
    const openDate = formatShortDate(WINTER_WINDOW_OPEN_WEEK, season);
    return `Window Closed — Opens ${openDate} (${weeksUntil}w)`;
  }
  return 'Transfer Window Closed';
};

/**
 * Compute a player's market value in millions £ based on rating and age.
 * Peaks around age 24-26, drops sharply after 30.
 * Tune via ENGINE_CONFIG.MARKET_VALUE_POWER and MARKET_VALUE_DIVISOR.
 */
export const computeMarketValue = (rating: number, age: number): number => {
  const { MARKET_VALUE_POWER, MARKET_VALUE_DIVISOR } = ENGINE_CONFIG;
  const baseValue = Math.pow(rating, MARKET_VALUE_POWER) / MARKET_VALUE_DIVISOR;
  let ageMult = 1.0;
  if (age <= 21) ageMult = 0.75;
  else if (age <= 23) ageMult = 0.9;
  else if (age <= 26) ageMult = 1.0;
  else if (age <= 28) ageMult = 0.85;
  else if (age <= 30) ageMult = 0.65;
  else if (age <= 32) ageMult = 0.40;
  else ageMult = 0.20;
  return Math.round(baseValue * ageMult * 10) / 10; // 1 decimal place
};

/**
 * Returns a starting budget for a team based on class.
 */
export const getBudgetForClass = (teamClass: string): number => {
  switch (teamClass) {
    case 'S': return 150;
    case 'A': return 90;
    case 'B': return 55;
    case 'C': return 30;
    case 'D': return 15;
    case 'E': return 8;
    case 'F': return 4;
    default: return 20;
  }
};
