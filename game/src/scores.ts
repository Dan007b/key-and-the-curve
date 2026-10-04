/**
 * High scores: the best five runs of each level, kept in this browser's
 * localStorage (a per-player convenience; the game works without it).
 *
 * Runs rank by stars, then time, then lives left. Stars: three for finishing
 * under par without being hit, two for finishing within 1.5× par, one
 * otherwise. Levels are keyed by name, so reordering levels keeps scores.
 */

export interface ScoreEntry {
  name: string;
  /** Seconds, rounded to tenths. */
  time: number;
  lives: number;
  stars: number;
  /** Local date (yyyy-mm-dd) of the run. */
  date: string;
}

export type ScoreBook = Record<string, ScoreEntry[]>;

/** Runs kept per level. */
export const TABLE_SIZE = 5;
const STORAGE_KEY = 'phase-escape.scores.v1';
const NAME_KEY = 'phase-escape.player.v1';

/** Stars for a finished run. */
export function starsFor(time: number, lives: number, maxLives: number, par: number): number {
  if (lives === maxLives && time <= par) return 3;
  return time <= par * 1.5 ? 2 : 1;
}

/** Sort order: more stars, then faster, then more lives left. */
export function compareRuns(a: ScoreEntry, b: ScoreEntry): number {
  return b.stars - a.stars || a.time - b.time || b.lives - a.lives;
}

/**
 * Where `entry` would land in `table` (0-based), or −1 if it would not make
 * the top TABLE_SIZE. Ties go below existing runs (first to set it keeps it).
 */
export function rankOf(table: readonly ScoreEntry[], entry: ScoreEntry): number {
  const rank = table.filter((e) => compareRuns(e, entry) <= 0).length;
  return rank < TABLE_SIZE ? rank : -1;
}

/** The table with `entry` inserted at its rank and trimmed to TABLE_SIZE. */
export function insertRun(table: readonly ScoreEntry[], entry: ScoreEntry): ScoreEntry[] {
  const rank = rankOf(table, entry);
  if (rank === -1) return [...table];
  return [...table.slice(0, rank), entry, ...table.slice(rank)].slice(0, TABLE_SIZE);
}

/** m:ss.t */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function loadScores(): ScoreBook {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ScoreBook;
  } catch {
    // Storage unavailable or corrupt: start empty.
  }
  return {};
}

export function saveScores(book: ScoreBook): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch {
    // Not fatal: scores just won't persist.
  }
}

/** The name last typed into a score table. */
export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not fatal.
  }
}
