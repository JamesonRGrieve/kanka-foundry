import { describe, expect, it } from 'vitest';
import { isNonEmptyString, isRecord, readFunction } from './reflection';

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

describe('readFunction', () => {
    it('returns undefined when the property is absent or not callable', () => {
        expect(readFunction({ toObject: 42 }, 'toObject')).toBeUndefined();
        expect(readFunction({}, 'toObject')).toBeUndefined();
        expect(readFunction(null, 'toObject')).toBeUndefined();
    });

    it('returns an UNBOUND method — the receiver must be re-supplied via .call', () => {
        // Regression: a Foundry Document#toObject dereferences `this._source`. The
        // reflected method is detached from its receiver, so invoking it as `fn()`
        // loses `this` and throws "cannot read properties of undefined (reading
        // '_source')" — the exact actor-link crash. Callers must `.call(receiver)`.
        const doc = {
            _source: { name: 'Aberrant' },
            toObject(this: { _source: { name: string } }) {
                return this._source;
            },
        };
        const fn = readFunction<() => { name: string }>(doc, 'toObject');
        expect(fn).toBeDefined();
        // Detached invocation loses `this` and reproduces the crash.
        expect(() => fn?.()).toThrow(/_source/);
        // Bound invocation (what the call sites must do) works.
        expect(fn?.call(doc)).toEqual({ name: 'Aberrant' });
    });
});
