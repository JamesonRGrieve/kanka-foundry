import type { KankaApiResult } from '../types/kanka';
import type AccessToken from './AccessToken';
import NotAuthenticatedError from './NotAuthenticatedError';
import RateLimiter from './RateLimiter';

const freeLimit = 30;

export default class KankaFetcher {
    #base: string;
    #token?: AccessToken;
    #limiter = new RateLimiter(61, freeLimit);

    constructor(base: string) {
        this.#base = this.normalizeUrl(base);
    }

    public get limiter(): RateLimiter {
        return this.#limiter;
    }

    public reset(): void {
        this.#token = undefined;
    }

    public get hasToken(): boolean {
        return Boolean(this.#token);
    }

    public set token(token: AccessToken) {
        this.#token = token;
    }

    public get token(): AccessToken | undefined {
        return this.#token;
    }

    public set base(base: string) {
        this.#base = this.normalizeUrl(base);
        this.#limiter.reset();
    }

    public get base(): string {
        return this.#base;
    }

    private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
        if (!this.#token) {
            throw new Error('Missing token in KankaFetcher');
        }

        await this.#limiter.slot();

        const url = path.startsWith('http') ? path : `${this.#base}${path}`;

        const options: RequestInit = {
            method,
            mode: 'cors',
            headers: {
                Authorization: `Bearer ${this.#token.toString()}`,
                'Content-type': 'application/json',
            },
        };

        if (body !== undefined) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        const limit = response.headers.get('X-RateLimit-Limit');
        const limitRemaining = response.headers.get('X-RateLimit-Remaining');

        if (limit) this.#limiter.limit = Number.parseInt(limit, 10);
        if (limitRemaining) this.#limiter.remaining = Number.parseInt(limitRemaining, 10);

        if (response.status === 401) {
            throw new NotAuthenticatedError('Unauthorized');
        }

        if (!response.ok) {
            throw new Error(`Kanka request error: ${response.statusText} (${response.status})`);
        }

        return response.json() as T;
    }

    public async fetch<T extends KankaApiResult<unknown>>(path: string): Promise<T> {
        return this.request<T>(path, 'GET');
    }

    public async post<T extends KankaApiResult<unknown>>(path: string, body: unknown): Promise<T> {
        return this.request<T>(path, 'POST', body);
    }

    public async patch<T extends KankaApiResult<unknown>>(path: string, body: unknown): Promise<T> {
        return this.request<T>(path, 'PATCH', body);
    }

    public async delete(path: string): Promise<void> {
        await this.request<unknown>(path, 'DELETE');
    }

    private normalizeUrl(url: string): string {
        let result = url.trim();

        if (!result.endsWith('/')) {
            result = `${result}/`;
        }

        if (!result.startsWith('https://api.kanka.io/') && !result.endsWith('api/1.0/')) {
            result = `${result}api/1.0/`;
        }

        if (!result.endsWith('1.0/')) {
            result = `${result}1.0/`;
        }

        if (!result.startsWith('http')) {
            result = `https://${result}`;
        }

        return result;
    }
}
