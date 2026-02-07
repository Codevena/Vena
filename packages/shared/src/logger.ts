import pino from 'pino';

export function createLogger(name: string, level: string = 'info'): pino.Logger {
  return pino({
    name,
    level,
    transport: process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger('vena');

export type Logger = pino.Logger;
