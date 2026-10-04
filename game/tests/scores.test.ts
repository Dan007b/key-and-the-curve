import { describe, expect, it } from 'vitest';
import { TABLE_SIZE, compareRuns, formatTime, insertRun, rankOf, starsFor } from '../src/scores';
import type { ScoreEntry } from '../src/scores';

const run = (name: string, time: number, stars = 2, lives = 3): ScoreEntry => ({ name, time, stars, lives, date: '2026-10-03' });

describe('high scores', () => {
  it('awards stars for par and lives', () => {
    expect(starsFor(50, 3, 3, 60)).toBe(3);
    expect(starsFor(50, 2, 3, 60)).toBe(2); // hit once: no third star
    expect(starsFor(85, 3, 3, 60)).toBe(2); // within 1.5 × par
    expect(starsFor(95, 3, 3, 60)).toBe(1);
  });

  it('ranks by stars, then time, then lives', () => {
    const sorted = [run('c', 40, 2), run('a', 90, 3), run('b', 50, 3), run('d', 40, 2, 1)].sort(compareRuns);
    expect(sorted.map((r) => r.name)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps the best few, and a tie goes below the run that set it first', () => {
    let table: ScoreEntry[] = [];
    for (let i = 0; i < TABLE_SIZE; i++) table = insertRun(table, run(`r${i}`, 60 + i * 10));
    expect(table).toHaveLength(TABLE_SIZE);
    expect(rankOf(table, run('slow', 999))).toBe(-1);
    expect(insertRun(table, run('slow', 999))).toEqual(table);
    expect(rankOf(table, run('tie', 60))).toBe(1);
    const better = insertRun(table, run('fast', 30));
    expect(better[0].name).toBe('fast');
    expect(better).toHaveLength(TABLE_SIZE);
    expect(better.map((r) => r.name)).not.toContain(`r${TABLE_SIZE - 1}`);
  });

  it('formats times as m:ss.t', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(75.25)).toBe('1:15.3');
    expect(formatTime(600)).toBe('10:00.0');
  });
});
