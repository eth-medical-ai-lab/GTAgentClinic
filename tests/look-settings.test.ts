/**
 * The mouse-look setting (client/src/ui/lookSettings.ts): a stored value is read back field by field,
 * out-of-range or broken values fall back to the safe range or the default, and nothing throws.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, SENSITIVITY_MAX, SENSITIVITY_MIN, clampSensitivity, parseLook } from '../client/src/ui/lookSettings';

describe('look settings', () => {
  it('defaults to the built-in speed, not inverted', () => {
    expect(parseLook(null)).toEqual({ sensitivity: 1, invertY: false });
    expect(DEFAULT_LOOK).toEqual({ sensitivity: 1, invertY: false });
  });

  it('reads back what was saved', () => {
    expect(parseLook(JSON.stringify({ sensitivity: 1.75, invertY: true }))).toEqual({ sensitivity: 1.75, invertY: true });
  });

  it('keeps sensitivity in range', () => {
    expect(clampSensitivity(0)).toBe(SENSITIVITY_MIN);
    expect(clampSensitivity(10)).toBe(SENSITIVITY_MAX);
    expect(clampSensitivity(Number.NaN)).toBe(1);
    expect(parseLook(JSON.stringify({ sensitivity: 99 })).sensitivity).toBe(SENSITIVITY_MAX);
  });

  it('falls back field by field on broken or partial values', () => {
    expect(parseLook('not json')).toEqual(DEFAULT_LOOK);
    expect(parseLook('null')).toEqual(DEFAULT_LOOK);
    expect(parseLook(JSON.stringify({ sensitivity: 'fast', invertY: 'yes' }))).toEqual(DEFAULT_LOOK);
    expect(parseLook(JSON.stringify({ invertY: true }))).toEqual({ sensitivity: 1, invertY: true });
  });
});
