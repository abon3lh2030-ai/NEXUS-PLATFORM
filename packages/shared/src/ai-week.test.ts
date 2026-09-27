import { describe, expect, it } from 'vitest';
import { aiWeekResetsAt, aiWeekStart, weeklyAiLimit } from './billing.js';

describe('AI usage week (Sunday 00:00 Riyadh)', () => {
  it('starts on the previous Sunday 00:00 Riyadh = Saturday 21:00 UTC', () => {
    // Wednesday 2026-09-30 10:00 Riyadh
    expect(aiWeekStart(new Date('2026-09-30T07:00:00Z')).toISOString()).toBe('2026-09-26T21:00:00.000Z');
  });
  it('Saturday 23:59 Riyadh is still the old week; Sunday 00:00 Riyadh starts a new one', () => {
    expect(aiWeekStart(new Date('2026-10-03T20:59:00Z')).toISOString()).toBe('2026-09-26T21:00:00.000Z');
    expect(aiWeekStart(new Date('2026-10-03T21:00:00Z')).toISOString()).toBe('2026-10-03T21:00:00.000Z');
  });
  it('resets exactly 7 days after the week start', () => {
    expect(aiWeekResetsAt(new Date('2026-09-30T07:00:00Z')).toISOString()).toBe('2026-10-03T21:00:00.000Z');
  });
  it('splits the annual limit over 53 weeks', () => {
    expect(weeklyAiLimit(35000)).toBe(660);
    expect(weeklyAiLimit(null)).toBeNull();
  });
});
