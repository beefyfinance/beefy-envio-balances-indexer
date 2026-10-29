/**
 * What may be shown of an error: in logs, on a terminal, in a response. Raw messages are never printed, because some
 * carry secrets: viem puts the request URL (an RPC key in its path or query) and body in `details`, fetch errors name
 * the URL, a database error can quote its statement.
 *
 * Known errors map to a fixed text ({@link KNOWN}); any other gives its name and its short message (viem's
 * `shortMessage` when there is one), with every URL cut to its scheme and host, on one line, at most 300 characters.
 */
const MAX_LENGTH = 300;

type ErrorLike = Error & { shortMessage?: string; status?: number; code?: string | number; type?: string };

/** By error name: what is said instead of the message. */
const KNOWN: Record<string, (error: ErrorLike) => string> = {
    // ours: the list of configuration problems, which never quotes a value
    ConfigError: (error) => error.message,
    // viem
    HttpRequestError: (error) =>
        `RPC HTTP request failed${error.status === undefined ? '' : ` (status ${error.status})`}`,
    TimeoutError: () => 'request timed out',
    // fetch and AbortSignal.timeout
    AbortError: () => 'request aborted',
};

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/[^\s'"`<>()[\]{},]+/gi;

/** A URL as scheme and host only: no credentials, path or query, where keys live. */
export const redactUrl = (value: string): string => {
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return '***';
    }
};

const clean = (text: string): string => {
    const line = text
        .replace(URL_PATTERN, (url) => redactUrl(url))
        .replace(/\s+/g, ' ')
        .trim();
    return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH)}…` : line;
};

export const describeError = (error: unknown): string => {
    if (!(error instanceof Error)) return typeof error === 'string' ? clean(error) : 'unknown error';
    const known = KNOWN[error.name];
    if (known !== undefined) return known(error);
    const message = (error as ErrorLike).shortMessage ?? error.message;
    const text = clean(message);
    return error.name === 'Error' || text.startsWith(error.name) ? text : `${error.name}: ${text}`;
};
