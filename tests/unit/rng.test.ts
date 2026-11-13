import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';

describe('Rng', () => {
  it('same seed gives same sequence', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('different seeds and streams diverge', () => {
    expect(new Rng('abc').next()).not.toBe(new Rng('abd').next());
    expect(Rng.stream('abc', 'events').next()).not.toBe(Rng.stream('abc', 'loot').next());
  });
  it('stays in [0,1) and state round-trips', () => {
    const r = new Rng('x');
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const copy = new Rng(r.getState());
    expect(copy.next()).toBe(r.next());
  });
});
