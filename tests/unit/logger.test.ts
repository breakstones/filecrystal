import { describe, expect, it, vi } from 'vitest';
import { noopLogger, consoleLogger } from '../../src/utils/logger.js';

describe('noopLogger', () => {
  it('is a quiet logger that returns undefined for each level', () => {
    expect(noopLogger.debug('x')).toBeUndefined();
    expect(noopLogger.info('x')).toBeUndefined();
    expect(noopLogger.warn('x')).toBeUndefined();
    expect(noopLogger.error('x')).toBeUndefined();
  });
});

describe('consoleLogger', () => {
  it('routes debug/info/warn/error through console', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      consoleLogger.debug('d');
      consoleLogger.info('i');
      consoleLogger.warn('w');
      consoleLogger.error('e');
      expect(warnSpy).toHaveBeenCalledWith('[filecrystal:warn]', 'w', '');
      expect(errorSpy).toHaveBeenCalledWith('[filecrystal:error]', 'e', '');
      expect(errorSpy).toHaveBeenCalledWith('[filecrystal:debug]', 'd', '');
      expect(errorSpy).toHaveBeenCalledWith('[filecrystal:info]', 'i', '');
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
