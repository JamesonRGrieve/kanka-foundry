import { describe, expect, it } from 'vitest';
import { isNonEmptyString, isRecord } from './reflection';

describe('isNonEmptyString', () => {
    it('is true for a non-empty string', () => {
        expect(isNonEmptyString('portrait.webp')).toBe(true);
        expect(isNonEmptyString(' ')).toBe(true);
    });

    it('is false for an empty string', () => {
        // The image-preservation guard: an empty img must not overwrite an
        // existing portrait when Kanka supplies no custom image.
        expect(isNonEmptyString('')).toBe(false);
    });

    it('is false for undefined, null, and non-string values', () => {
        expect(isNonEmptyString(undefined)).toBe(false);
        expect(isNonEmptyString(null)).toBe(false);
        expect(isNonEmptyString(0)).toBe(false);
        expect(isNonEmptyString(42)).toBe(false);
        expect(isNonEmptyString({})).toBe(false);
        expect(isNonEmptyString([])).toBe(false);
    });
});

describe('isRecord', () => {
    it('is true for a plain object', () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord({ a: 1 })).toBe(true);
    });

    it('is false for null, arrays, and primitives', () => {
        expect(isRecord(null)).toBe(false);
        expect(isRecord([])).toBe(false);
        expect(isRecord('x')).toBe(false);
        expect(isRecord(3)).toBe(false);
    });
});
