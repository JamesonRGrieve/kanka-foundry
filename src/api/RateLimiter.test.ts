import { describe, expect, it, vi } from 'vitest';
import RateLimiter from './RateLimiter';

vi.mock('../util/logger');

describe('RateLimiter', () => {
    describe('constructor', () => {
        it('sets correct remaining property', () => {
            const limiter = new RateLimiter(10, 5);
            expect(limiter.remaining).toEqual(5);
        });
    });

    describe('slot()', () => {
        // Pass-through impl: slot() always resolves immediately and never queues.
        // The timeframe / limit are tracked for the debug display only.
        it('resolves immediately', async () => {
            const limiter = new RateLimiter(10, 1);
            await expect(limiter.slot()).resolves.toBeUndefined();
        });

        it('decreases remaining while the slot is active', () => {
            const limiter = new RateLimiter(10, 2);
            expect(limiter.remaining).toEqual(2);

            limiter.slot();
            expect(limiter.remaining).toEqual(1);

            limiter.slot();
            expect(limiter.remaining).toEqual(0);
        });

        it('frees the slot after the timeframe elapses', () => {
            vi.useFakeTimers();
            try {
                const limiter = new RateLimiter(10, 1);
                limiter.slot();
                expect(limiter.remaining).toEqual(0);

                vi.advanceTimersByTime(10_000);
                expect(limiter.remaining).toEqual(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('notifies change listeners on activation', () => {
            const onChange = vi.fn();
            const limiter = new RateLimiter(10, 2);
            limiter.onChange(onChange);

            limiter.slot();

            expect(onChange).toHaveBeenCalledWith({
                maxSlots: 2,
                remainingSlots: 1,
                usedSlots: 1,
                queue: 0,
            });
        });
    });

    describe('reset()', () => {
        it('clears active slots', () => {
            const limiter = new RateLimiter(10, 2);
            limiter.slot();
            limiter.slot();
            expect(limiter.remaining).toEqual(0);

            limiter.reset();

            expect(limiter.remaining).toEqual(2);
        });

        it('calls change listeners', () => {
            const onChange1 = vi.fn();
            const onChange2 = vi.fn();
            const limiter = new RateLimiter(10, 2);
            limiter.onChange(onChange1);
            limiter.onChange(onChange2);

            limiter.reset();

            const expected = { maxSlots: 2, remainingSlots: 2, usedSlots: 0, queue: 0 };
            expect(onChange1).toHaveBeenCalledWith(expected);
            expect(onChange2).toHaveBeenCalledWith(expected);
        });
    });

    describe('set remaining', () => {
        // The setter is intentionally a no-op for self-hosted instances with
        // high limits — only the non-negative validation is preserved.
        it('throws an exception if a negative value is set', () => {
            const limiter = new RateLimiter(10, 2);
            expect(() => {
                limiter.remaining = -1;
            }).toThrow(Error);
        });
    });

    describe('set limit', () => {
        it('sets the new remaining value correctly', () => {
            const limiter = new RateLimiter(10, 2);
            limiter.limit = 3;
            expect(limiter.remaining).toEqual(3);
        });

        it('throws an exception if a negative value is set', () => {
            const limiter = new RateLimiter(10, 2);
            expect(() => {
                limiter.limit = -1;
            }).toThrow(Error);
        });

        it('calls change listeners', () => {
            const onChange = vi.fn();
            const limiter = new RateLimiter(10, 2);
            limiter.onChange(onChange);

            limiter.limit = 4;

            expect(onChange).toHaveBeenCalledWith({
                maxSlots: 4,
                remainingSlots: 4,
                usedSlots: 0,
                queue: 0,
            });
        });
    });
});
