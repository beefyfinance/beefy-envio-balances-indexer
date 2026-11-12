import { createLogger } from '@beefy/config';

/** The proxy's logger (JSON lines, warnings on stderr: see `createLogger`). */
export const log = createLogger('rpc-cache-proxy');
