/**
 * `fetch` for the Beefy API, which usually answers in well under a second: every attempt is cut after `timeoutMs`, and
 * a network error, a timeout, a 429 or a 5xx is tried again after each of `retryDelaysMs` (so `retryDelaysMs.length + 1`
 * attempts in all). Returns the last response, whatever its status (the caller checks `ok`), or throws the last error.
 */
export type RetryOptions = {
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    retryDelaysMs?: readonly number[];
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000];

const retryable = (status: number): boolean => status === 429 || status >= 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchWithRetry = async (
    url: URL | string,
    init: RequestInit = {},
    {
        fetch = globalThis.fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    }: RetryOptions = {}
): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
        const last = attempt >= retryDelaysMs.length;
        try {
            const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
            if (last || !retryable(response.status)) return response;
        } catch (error) {
            if (last) throw error;
        }
        await sleep(retryDelaysMs[attempt] ?? 0);
    }
};
