/**
 * The amenities' sounds (client/src/audio/amenities.ts) are rendered offline like the rest of the
 * soundscape: right length for the animations they go with, clean (finite, normalized, no clicks at
 * the ends), and the coffee machine's pour actually fills its timeline.
 */
import { describe, expect, it } from 'vitest';
import { BREW, VEND, brew, canOpen, cupDown, cupPull, lidSnap, mugLift, payBeep, pump, rub, sip, toss, tossCan, vend } from '../client/src/audio/amenities';
import { peak, rms } from '../client/src/audio/synth';

const SR = 24000;
const seg = (x: Float32Array, a: number, b: number) => x.subarray(Math.round(a * SR), Math.round(b * SR));

describe('amenity sounds', () => {
  it('every sound is finite, normalized and starts and ends quietly', () => {
    for (const [name, x] of Object.entries({ brew: brew(SR), vend: vend(SR), pump: pump(SR), rub: rub(SR), toss: toss(SR), tossCan: tossCan(SR), canOpen: canOpen(SR), sip: sip(SR), cupDown: cupDown(SR) })) {
      expect(x.every(Number.isFinite), name).toBe(true);
      expect(peak(x), name).toBeGreaterThan(0.5);
      expect(peak(x), name).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(Math.abs(x[x.length - 1]), name).toBeLessThan(0.05);
    }
  });

  it('the brew lasts the 15 s the machine animates: grinder, then the pour, then quiet drips', () => {
    const x = brew(SR);
    expect(x.length / SR).toBeCloseTo(BREW.length, 1);
    const grind = rms(seg(x, BREW.grindAt + 0.3, BREW.grindEnd - 0.3));
    const pour = rms(seg(x, BREW.pourAt + 1, BREW.pourEnd - 1));
    const gap = rms(seg(x, BREW.grindEnd + 0.05, BREW.grindEnd + 0.2));
    const after = rms(seg(x, BREW.done + 0.15, BREW.length - 0.01));
    expect(grind).toBeGreaterThan(gap * 2);
    expect(pour).toBeGreaterThan(gap);
    expect(after).toBeLessThan(pour / 3);
  });

  it('a cup off its stack, a lid pressed on, a mug off the rack, a card terminal\'s beep: short and clean', () => {
    for (const [name, x, max] of [
      ['cupPull', cupPull(SR), 0.6],
      ['lidSnap', lidSnap(SR), 0.75],
      ['mugLift', mugLift(SR), 0.6],
      ['payBeep', payBeep(SR), 0.7],
    ] as [string, Float32Array, number][]) {
      expect(x.every(Number.isFinite), name).toBe(true);
      expect(peak(x), name).toBeGreaterThan(0.3);
      expect(peak(x), name).toBeLessThanOrEqual(max + 1e-6);
      expect(x.length / SR, name).toBeLessThan(0.35);
      expect(Math.abs(x[x.length - 1]), name).toBeLessThan(0.05);
    }
  });

  it('the vending machine drops the can when the animation does', () => {
    const x = vend(SR);
    expect(x.length / SR).toBeCloseTo(VEND.length, 1);
    expect(rms(seg(x, VEND.drop, VEND.drop + 0.08))).toBeGreaterThan(rms(seg(x, VEND.drop - 0.2, VEND.drop - 0.05)) * 2);
  });
});
