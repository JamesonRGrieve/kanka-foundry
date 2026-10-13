import type { KankaApiResult } from '../types/kanka';
import type AccessToken from './AccessToken';
import NotAuthenticatedError from './NotAuthenticatedError';
import RateLimiter from './RateLimiter';

function assertType<T>(_value: unknown): asserts _value is T {}

const defaultLimit = 300;

const errorBodyMaxLength = 500;

/**
 * Build an error carrying whatever Kanka said. HTTP/2 has no reason phrase, so
 * `response.statusText` is empty and a status alone is undiagnosable — a 422
 * from the upload endpoint is only actionable once its validation body is read.
 */
async function requestError(label: string, response: Response): Promise<Error> {
    let body = '';
    try {
        body = (await response.text()).trim();
    } catch {
        // A body that cannot be read must not mask the status we already have.
    }

    const detail = body.length > errorBodyMaxLength ? `${body.slice(0, errorBodyMaxLength)}…` : body;
    const reason = [response.statusText, detail].filter(Boolean).join(' — ');
    return new Error(`${label}: ${reason || 'no details'} (${String(response.status)})`);
}

export default class KankaFetcher {
    #base: string;
    #token: AccessToken | undefined = undefined;
    readonly #limiter = new RateLimiter(61, defaultLimit);

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
                'Authorization': `Bearer ${this.#token.toString()}`,
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
            throw await requestError('Kanka request error', response);
        }

        const json: unknown = await response.json();
        assertType<T>(json);
        return json;
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

    /**
     * `filename` is required because Kanka validates the uploaded part by its
     * extension: a `FormData` part built from a bare `Blob` is transmitted as
     * `filename="blob"` with no extension, which the API rejects.
     */
    public async uploadFile<T extends KankaApiResult<unknown>>(path: string, file: Blob, fieldName: string, filename: string): Promise<T> {
        if (!this.#token) {
            throw new Error('Missing token in KankaFetcher');
        }

        await this.#limiter.slot();

        const url = path.startsWith('http') ? path : `${this.#base}${path}`;
        const formData = new FormData();
        formData.append(fieldName, file, filename);

        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: {
                Authorization: `Bearer ${this.#token.toString()}`,
            },
            body: formData,
        });

        const limit = response.headers.get('X-RateLimit-Limit');
        const limitRemaining = response.headers.get('X-RateLimit-Remaining');
        if (limit) this.#limiter.limit = Number.parseInt(limit, 10);
        if (limitRemaining) this.#limiter.remaining = Number.parseInt(limitRemaining, 10);

        if (!response.ok) {
            throw await requestError('Kanka upload error', response);
        }

        return response.json();
    }

    private normalizeUrl(url: string): string {
        let result = url.trim();

        if (!result.endsWith('/')) {
            result = `${result}/`;
        }

        if (!result.startsWith('http')) {
            result = `https://${result}`;
        }

        // Already has versioned API path
        if (result.endsWith('1.0/')) {
            return result;
        }

        // Official kanka.io uses /api/ prefix; self-hosted does not
        if (result.includes('kanka.io')) {
            result = `${result}api/1.0/`;
        } else {
            result = `${result}1.0/`;
        }

        return result;
    }
}
