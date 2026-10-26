import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

const route = createRoute({
    method: 'get',
    path: '/healthz',
    tags: ['meta'],
    summary: 'Liveness probe',
    responses: {
        200: {
            description: 'The process is up',
            content: { 'application/json': { schema: z.object({ status: z.literal('ok') }).openapi('Health') } },
        },
    },
});

export const registerHealth = (app: OpenAPIHono): void => {
    app.openapi(route, (context) => context.json({ status: 'ok' as const }, 200));
};
