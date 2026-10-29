import { createLogger } from '@beefy/config';

/** The API's logger (JSON lines, warnings and errors on stderr: see `createLogger`). */
export const log = createLogger('api');
