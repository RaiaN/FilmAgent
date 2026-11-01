/**
 * @jest-environment node
 */
// THE RUN'S LIMITS: what holds whatever the model decides.
import { createRunRules } from '../utils/film/agentRules.mjs';

const limits = { calls: 5, failedRenders: 2, errors: 2, hardStopAfter: 2 };

describe('a run', () => {
  test('after two failed renders no render starts, and the rest still works', () => {
    const r = createRunRules(limits);
    expect(r.before('generate_video')).toBe('');
    r.after({ name: 'T1', status: 'failed' });
    expect(r.before('edit_video')).toBe('');
    r.after({ results: [{ name: 'T1', status: 'failed' }, { name: 'T2', status: 'failed' }] });
    expect(r.before('generate_video')).toContain('2 renders failed in this run (T1, T2)');
    expect(r.before('finish')).toContain('Start no more work');
    expect(r.before('look')).toBe('');
  });
  test('a render that finishes does not count', () => {
    const r = createRunRules(limits);
    r.after({ results: [{ name: 'T1', status: 'done' }, { name: 'T2', status: 'running' }] });
    expect(r.stats().failed).toEqual([]);
  });
  test('the same refusal twice closes that tool, and only that tool', () => {
    const r = createRunRules({ ...limits, errors: 9 });
    r.error('edit_video', 'T1 is too short');
    expect(r.before('edit_video')).toBe('');
    r.error('edit_video', 'T1 is too short');
    expect(r.before('edit_video')).toContain('edit_video is closed for this run: T1 is too short');
    expect(r.before('look')).toBe('');
  });
  test('a dropped connection is not a refusal: nothing closes and nothing counts', () => {
    const r = createRunRules(limits);
    ['fetch failed', 'fetch failed', 'fetch failed', 'manifest fetch failed: Client network socket disconnected before secure TLS connection was established'].forEach((m) => r.error('wait', m, {}));
    expect(r.before('wait')).toBe('');
    expect(r.stats().errors).toBe(0);
  });
  test('a refused source stays refused along any other route', () => {
    const r = createRunRules({ ...limits, errors: 9 });
    r.error('edit_video', 'T1 is 3 s. An edit takes 4 to 30 s.', { source: 'T1' });
    expect(r.before('generate_video', { video_refs: ['t1'] })).toContain("T1 was refused: T1 is 3 s");
    expect(r.before('generate_video', { video_refs: ['T2'] })).toBe('');
    expect(r.before('look', { name: 'T1' })).toBe('');
  });
  test('tool errors end the run', () => {
    const r = createRunRules(limits);
    r.error('a', 'one');
    r.error('b', 'two');
    expect(r.before('look')).toContain('2 tool errors');
  });
  test('past its call limit everything is refused, then the run is ended from outside', () => {
    const r = createRunRules(limits);
    for (let i = 0; i < 5; i += 1) expect(r.before('look')).toBe('');
    expect(r.before('look')).toContain('limit of 5 tool calls');
    expect(r.mustAbort()).toBe(false);
    r.before('look');
    r.before('look');
    expect(r.mustAbort()).toBe(true);
  });
});
