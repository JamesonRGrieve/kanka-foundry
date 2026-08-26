import { describe, expect, it } from 'vitest';
import { resolvePinnedPortrait } from './actorFactory';

const FRAME_A = { cx: 0.5, cy: 0.3, zoom: 1.67 };
const variants = [
    { img: 'cyril.png', tokenFrame: { cx: 0.447, cy: 0.32, zoom: 1.67 } },
    { img: 'brae.png', tokenFrame: { cx: 0.5, cy: 0.167, zoom: 1.67 } },
    { img: 'jorl.png', tokenFrame: null },
];

describe('resolvePinnedPortrait', () => {
    it('pin 0 selects the base image + its bust frame', () => {
        expect(resolvePinnedPortrait(0, 'kael.png', FRAME_A, variants)).toEqual({ img: 'kael.png', frame: FRAME_A });
    });

    it('pin 1+ indexes into the base variants (with each variant frame)', () => {
        expect(resolvePinnedPortrait(1, 'kael.png', FRAME_A, variants)).toEqual({ img: 'cyril.png', frame: { cx: 0.447, cy: 0.32, zoom: 1.67 } });
        expect(resolvePinnedPortrait(2, 'kael.png', FRAME_A, variants)).toEqual({ img: 'brae.png', frame: { cx: 0.5, cy: 0.167, zoom: 1.67 } });
    });

    it('carries a null frame when the variant has none', () => {
        expect(resolvePinnedPortrait(3, 'kael.png', FRAME_A, variants)).toEqual({ img: 'jorl.png', frame: null });
    });

    it('returns null for pin 0 when the base has no image', () => {
        expect(resolvePinnedPortrait(0, null, FRAME_A, variants)).toBeNull();
    });

    it('returns null for an out-of-range, negative, or non-integer pin', () => {
        expect(resolvePinnedPortrait(9, 'kael.png', FRAME_A, variants)).toBeNull();
        expect(resolvePinnedPortrait(-1, 'kael.png', FRAME_A, variants)).toBeNull();
        expect(resolvePinnedPortrait(Number.NaN, 'kael.png', FRAME_A, variants)).toBeNull();
        expect(resolvePinnedPortrait(1.5, 'kael.png', FRAME_A, variants)).toBeNull();
    });

    it('returns null when the targeted variant is malformed (not an object, or no img)', () => {
        expect(resolvePinnedPortrait(1, 'kael.png', FRAME_A, ['not-an-object'])).toBeNull();
        expect(resolvePinnedPortrait(1, 'kael.png', FRAME_A, [{ tokenFrame: FRAME_A }])).toBeNull();
    });
});
