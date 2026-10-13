import { describe, it, expect } from 'vitest';
import { maskSecrets, Logger } from '../../src/utils/logger.js';

describe('Logger and Secret Masking', () => {
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
});
