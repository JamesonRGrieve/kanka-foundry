interface ChangeEvent {
    usedSlots: number;
    maxSlots: number;
    remainingSlots: number;
    queue: number;
}

type ChangeListener = (event: ChangeEvent) => void;

export default class RateLimiter {
    readonly #timeframe: number;
    #limit: number;
    #active = 0;
    readonly #changeListeners: ChangeListener[] = [];

    constructor(timeframe: number, limit: number) {
        this.#timeframe = timeframe;
        this.#limit = limit;
    }

    public onChange(listener: ChangeListener): void {
        this.#changeListeners.push(listener);
    }

    public set limit(limit: number) {
        if (limit < 0) {
            throw new Error('RateLimiter.limit must not be negative');
        }
        this.#limit = limit;
        this.callListeners();
    }

    public set remaining(remaining: number) {
        // Respect server-reported remaining, but don't block on self-hosted
        if (remaining < 0) {
            throw new Error('RateLimiter.remaining must not be negative');
        }
    }

    public get remaining(): number {
        return this.#limit - this.#active;
    }

    public reset(): void {
        this.#active = 0;
        this.callListeners();
    }

    public async slot(): Promise<void> {
        // For self-hosted instances with high limits, just pass through.
        // Track active count for the debug display but don't block.
        this.#active++;
        setTimeout(() => {
            this.#active = Math.max(0, this.#active - 1);
            this.callListeners();
        }, this.#timeframe * 1000);
        this.callListeners();
        return Promise.resolve();
    }

    private callListeners(): void {
        const event: ChangeEvent = {
            usedSlots: this.#active,
            maxSlots: this.#limit,
            remainingSlots: this.remaining,
            queue: 0,
        };

        for (const cb of this.#changeListeners) {
            cb({ ...event });
        }
    }
}
