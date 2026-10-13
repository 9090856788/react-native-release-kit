import { describe, it, expect, vi } from 'vitest';
import {
  validateSecretName,
  validateRequiredSecretNames,
  checkSecretNamesPresent,
  validateConfig,
} from '../../src/validators/index.js';
import { createDefaultConfig } from '../../src/config/defaults.js';
import { logger } from '../../src/utils/logger.js';

describe('Validators Subsystem', () => {
  describe('Secret Validators', () => {
    it('accepts valid SCREAMING_SNAKE_CASE secret names including iOS signing secrets', () => {
      expect(validateSecretName('ANDROID_KEYSTORE_BASE64').valid).toBe(true);
      expect(validateSecretName('APP_STORE_CONNECT_API_KEY_KEY_CONTENT').valid).toBe(true);
      expect(validateSecretName('APP_STORE_CONNECT_API_KEY_KEY_ID').valid).toBe(true);
      expect(validateSecretName('APP_STORE_CONNECT_API_KEY_ISSUER_ID').valid).toBe(true);
      expect(validateSecretName('MY_SECRET_123').valid).toBe(true);
    });

    it('rejects invalid secret names (lowercase, special characters, values)', () => {
      expect(validateSecretName('android_secret').valid).toBe(false);
      expect(validateSecretName('SECRET-NAME').valid).toBe(false);
      expect(validateSecretName('123_SECRET').valid).toBe(false);
      expect(validateSecretName('ghp_abcdef1234567890').valid).toBe(false);
    });

    it('validates lists of required secret names', () => {
      const good = validateRequiredSecretNames(['SECRET_A', 'SECRET_B']);
      expect(good.valid).toBe(true);

      const bad = validateRequiredSecretNames(['SECRET_A', 'invalid-secret']);
      expect(bad.valid).toBe(false);
      expect(bad.errors.length).toBeGreaterThan(0);
    });

    it('validates every secret in default configuration consistently', () => {
      const def = createDefaultConfig('TestApp');
      const allSecrets = [
        def.signing!.android!.keystoreSecretName!,
        def.signing!.android!.keystorePasswordSecretName!,
        def.signing!.android!.keyAliasSecretName!,
        def.signing!.android!.keyPasswordSecretName!,
        def.signing!.ios!.appStoreConnectKeyContentSecretName!,
        def.signing!.ios!.appStoreConnectKeyIdSecretName!,
        def.signing!.ios!.appStoreConnectIssuerIdSecretName!,
      ];

      const res = validateRequiredSecretNames(allSecrets);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('checkSecretNamesPresent identifies present and missing variables safely without leaking secret values', () => {
      const secretValue = 'super-secret-p8-key-content-that-must-not-leak';
      const env = {
        APP_STORE_CONNECT_API_KEY_KEY_CONTENT: secretValue,
        APP_STORE_CONNECT_API_KEY_KEY_ID: 'KEY1234567',
        APP_STORE_CONNECT_API_KEY_ISSUER_ID: '',
      };
      const result = checkSecretNamesPresent(
        [
          'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
          'APP_STORE_CONNECT_API_KEY_KEY_ID',
          'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
          'MISSING_KEY',
        ],
        env,
      );

      expect(result.present).toContain('APP_STORE_CONNECT_API_KEY_KEY_CONTENT');
      expect(result.present).toContain('APP_STORE_CONNECT_API_KEY_KEY_ID');
      expect(result.missing).toContain('APP_STORE_CONNECT_API_KEY_ISSUER_ID');
      expect(result.missing).toContain('MISSING_KEY');

      // Crucial: ensure the actual secret value is never contained anywhere in the result
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretValue);
      expect(serialized).not.toContain('KEY1234567');
    });

    it('ensures secret values are never printed by logger even if inadvertently logged', () => {
      const rawSecret = 'secret_value_xyz123';
      const logMessage = `Using key: ${rawSecret} for signing build`;

      const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        logger.info(logMessage);
        const loggedCall = debugSpy.mock.calls[0]?.[0] || '';
        expect(loggedCall).not.toContain(rawSecret);
        expect(loggedCall).toContain('[REDACTED]');
      } finally {
        debugSpy.mockRestore();
      }
    });
  });

  describe('Config Validator', () => {
    it('validates correct config and separate iOS signing secrets', () => {
      const res = validateConfig({
        projectName: 'ValidApp',
        signing: {
          android: {
            keystoreSecretName: 'CUSTOM_KEYSTORE',
            keystorePasswordSecretName: 'CUSTOM_PASS',
            keyAliasSecretName: 'CUSTOM_ALIAS',
            keyPasswordSecretName: 'CUSTOM_KEY_PASS',
          },
          ios: {
            appStoreConnectKeyContentSecretName: 'CUSTOM_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'CUSTOM_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'CUSTOM_ISSUER_ID',
          },
        },
      });

      expect(res.valid).toBe(true);
      expect(res.config?.projectName).toBe('ValidApp');
      expect(res.config?.signing.ios.appStoreConnectKeyContentSecretName).toBe(
        'CUSTOM_KEY_CONTENT',
      );
      expect(res.config?.signing.ios.appStoreConnectKeyIdSecretName).toBe('CUSTOM_KEY_ID');
      expect(res.config?.signing.ios.appStoreConnectIssuerIdSecretName).toBe('CUSTOM_ISSUER_ID');
    });

    it('rejects config when secret names violate conventions', () => {
      const res = validateConfig({
        projectName: 'BadApp',
        signing: {
          android: {
            keystoreSecretName: 'invalid-name-with-dashes',
          },
        },
      });

      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('invalid-name-with-dashes'))).toBe(true);
    });
  });
});
