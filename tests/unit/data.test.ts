import { describe, expect, it } from 'vitest';
import { loadDefs } from '../../src/data';
import { validateDefs } from '../../src/data/validate';

describe('content defs', () => {
  it('validate cleanly (ids, refs, recipe graph obtainability)', () => {
    expect(validateDefs(loadDefs())).toEqual([]);
  });
  it('validator catches broken references', () => {
    const d = loadDefs();
    d.rooms.kitchen!.tiers[0].cost.push({ item: 'unobtainium', qty: 1 });
    expect(validateDefs(d).some((e) => e.includes('unobtainium'))).toBe(true);
  });
});
