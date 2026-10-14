import { describe, it, expect, vi, afterEach } from 'vitest';
import { maskSecrets, Logger } from '../../src/utils/logger.js';

describe('Logger and Secret Masking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks secret patterns containing key, token, or password', () => {
    const raw = 'Configured with token: my-secret-token-1234 and password=superSecretPassword';
    const masked = maskSecrets(raw);

    expect(masked).not.toContain('my-secret-token-1234');
    expect(masked).not.toContain('superSecretPassword');
    expect(masked).toContain('[REDACTED]');
  });

  it('masks GitHub personal access tokens', () => {
    const raw = 'Found token ghp_1234567890abcdef1234567890abcdef in header';
    const masked = maskSecrets(raw);

    expect(masked).not.toContain('ghp_1234567890abcdef1234567890abcdef');
    expect(masked).toContain('[REDACTED_SECRET]');
  });

  it('leaves benign strings untouched', () => {
    const benign = 'Building release bundle for Android and iOS platforms.';
    expect(maskSecrets(benign)).toBe(benign);
  });

  it('respects log levels in Logger instance', () => {
    const log = new Logger({ level: 'error' });
    expect(log.getLevel()).toBe('error');
    expect(log.isDebug()).toBe(false);

    log.setLevel('debug');
    expect(log.getLevel()).toBe('debug');
    expect(log.isDebug()).toBe(true);
  });

  it('supports prefix configuration and getPrefix() on Logger instance', () => {
    const log = new Logger({ prefix: 'ReleaseKit' });
    expect(log.getPrefix()).toBe('ReleaseKit');

    const trimmedLog = new Logger({ prefix: '  CustomPrefix  ' });
    expect(trimmedLog.getPrefix()).toBe('CustomPrefix');

    const emptyLog = new Logger({ prefix: '' });
    expect(emptyLog.getPrefix()).toBeUndefined();

    const whitespaceLog = new Logger({ prefix: '   ' });
    expect(whitespaceLog.getPrefix()).toBeUndefined();
  });

  it('formats prefix in actual console output across info, warn, error, and debug', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const log = new Logger({ prefix: 'ReleaseKit', level: 'debug' });

    log.info('build succeeded');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('[ReleaseKit] build succeeded');

    log.warn('signing certificate expires soon');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      '[ReleaseKit] signing certificate expires soon',
    );

    log.error('failed to compile native bundle');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      '[ReleaseKit] failed to compile native bundle',
    );

    log.debug('resolving Gradle wrapper path');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(String(debugSpy.mock.calls[0]?.[0])).toContain(
      '[ReleaseKit] resolving Gradle wrapper path',
    );
  });

  it('maintains secret masking when a prefix is configured', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = new Logger({ prefix: 'SecureLogger' });

    log.info('Loaded token: secret=myVeryConfidentialPassword123');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const infoOutput = String(logSpy.mock.calls[0]?.[0]);
    expect(infoOutput).toContain('[SecureLogger]');
    expect(infoOutput).not.toContain('myVeryConfidentialPassword123');
    expect(infoOutput).toContain('[REDACTED]');

    log.error('Authentication failure with bearer mySensitiveBearerToken456');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const errorOutput = String(errorSpy.mock.calls[0]?.[0]);
    expect(errorOutput).toContain('[SecureLogger]');
    expect(errorOutput).not.toContain('mySensitiveBearerToken456');
    expect(errorOutput).toContain('[REDACTED_SECRET]');
  });

  it('does not introduce unwanted prefix formatting when prefix is absent, empty, or whitespace', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const defaultLog = new Logger();
    defaultLog.info('standard message without prefix');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const defaultOutput = String(logSpy.mock.calls[0]?.[0]);
    expect(defaultOutput).not.toContain('[');
    expect(defaultOutput).toContain('standard message without prefix');

    logSpy.mockClear();

    const emptyPrefixLog = new Logger({ prefix: '' });
    emptyPrefixLog.info('message with empty prefix string');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const emptyOutput = String(logSpy.mock.calls[0]?.[0]);
    expect(emptyOutput).not.toContain('[]');
    expect(emptyOutput).toContain('message with empty prefix string');

    logSpy.mockClear();

    const whitespaceLog = new Logger({ prefix: '   ' });
    whitespaceLog.info('message with whitespace prefix string');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const whitespaceOutput = String(logSpy.mock.calls[0]?.[0]);
    expect(whitespaceOutput).not.toContain('[]');
    expect(whitespaceOutput).toContain('message with whitespace prefix string');
  });
});
