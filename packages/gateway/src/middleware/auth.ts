import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AuthConfig {
  enabled: boolean;
  apiKeys: string[];
  excludePaths: string[];
}

export function authMiddleware(config: AuthConfig) {
  return async function (fastify: FastifyInstance): Promise<void> {
    if (!config.enabled) return;

    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const urlPath = request.url.split('?')[0] ?? '';

      // Skip excluded paths
      if (config.excludePaths.some(p => urlPath === p || urlPath.startsWith(p + '/'))) {
        return;
      }

      const authHeader = request.headers.authorization;
      const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

      let key: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        key = authHeader.slice(7);
      } else if (apiKeyHeader) {
        key = apiKeyHeader;
      }

      if (!key || !config.apiKeys.includes(key)) {
        return reply.status(401).send({ error: 'Unauthorized: invalid or missing API key' });
      }
    });
  };
}
