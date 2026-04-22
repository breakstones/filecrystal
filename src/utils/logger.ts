export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const consoleLogger: Logger = {
  debug: (msg, meta) => console.error('[filecrystal:debug]', msg, meta ?? ''),
  info: (msg, meta) => console.error('[filecrystal:info]', msg, meta ?? ''),
  warn: (msg, meta) => console.warn('[filecrystal:warn]', msg, meta ?? ''),
  error: (msg, meta) => console.error('[filecrystal:error]', msg, meta ?? ''),
};
