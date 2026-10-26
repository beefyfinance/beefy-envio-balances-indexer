import { CHAINS } from '@beefy/models';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { cacheControl } from '../http/cache.ts';

const ChainSchema = z
    .object({
        id: z.number().int().openapi({ example: 8453, description: 'EVM chain id' }),
        key: z.string().openapi({ example: 'base', description: 'Beefy chain key' }),
    })
    .openapi('Chain');

const route = createRoute({
    method: 'get',
    path: '/v1/chains',
    tags: ['chains'],
    summary: 'Chains with indexed data',
    // the list only changes with a deploy
    middleware: [cacheControl({ maxAgeSeconds: 3600, staleWhileRevalidateSeconds: 86_400 })],
    responses: {
        200: {
            description: 'Every indexed chain',
            content: { 'application/json': { schema: z.object({ chains: z.array(ChainSchema) }) } },
        },
    },
});

export const registerChains = (app: OpenAPIHono): void => {
    app.openapi(route, (context) => context.json({ chains: CHAINS.map(({ id, key }) => ({ id, key })) }, 200));
};
