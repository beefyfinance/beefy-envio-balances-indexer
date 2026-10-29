import { createLogger } from '@beefy/config';

/** The worker's logger (JSON lines, warnings on stderr: see `createLogger`). */
export const log = createLogger('worker');
