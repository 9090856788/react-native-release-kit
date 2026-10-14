import { describe, it, expect, vi } from 'vitest';
import {
  validateSecretName,
  validateRequiredSecretNames,
  checkSecretNamesPresent,
  validateConfig,
  validateIOSBundleId,
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

    it('validates iOS distribution signing configuration with teamId and certificate secrets', () => {
      const res = validateConfig({
        projectName: 'ValidIOSApp',
        ios: {
          teamId: 'TEAM123456',
        },
        signing: {
          ios: {
            enabled: true,
            teamId: 'TEAM123456',
            certificateSecretName: 'CUSTOM_IOS_DIST_CERT',
            certificatePasswordSecretName: 'CUSTOM_IOS_CERT_PWD',
            provisioningProfileSecretName: 'CUSTOM_IOS_PROV_PROFILE',
            exportMethod: 'app-store',
          },
        },
      });

      expect(res.valid).toBe(true);
      expect(res.config?.ios.teamId).toBe('TEAM123456');
      expect(res.config?.signing.ios.certificateSecretName).toBe('CUSTOM_IOS_DIST_CERT');
      expect(res.config?.signing.ios.certificatePasswordSecretName).toBe('CUSTOM_IOS_CERT_PWD');
      expect(res.config?.signing.ios.provisioningProfileSecretName).toBe('CUSTOM_IOS_PROV_PROFILE');
      expect(res.config?.signing.ios.exportMethod).toBe('app-store');
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

      const resIOS = validateConfig({
        projectName: 'BadApp',
        signing: {
          ios: {
            certificateSecretName: 'invalid_cert_secret',
          },
        },
      });

      expect(resIOS.valid).toBe(false);
      expect(resIOS.errors.some((e) => e.includes('invalid_cert_secret'))).toBe(true);
    });

    it('validates existing config with Xcode macro bundleId for debug while emitting warning', () => {
      const res = validateConfig({
        projectName: 'MacroApp',
        ios: {
          bundleId: 'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
        },
      });

      // Backward compatible for debug/simulator
      expect(res.valid).toBe(true);
      expect(res.warnings).toBeDefined();
      expect(
        res.warnings?.some((w) => w.includes('contains an unresolved Xcode build setting macro')),
      ).toBe(true);
    });

    it('rejects Xcode macro bundleId when production iOS validation is required', () => {
      const res = validateConfig(
        {
          projectName: 'MacroApp',
          ios: {
            bundleId: 'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
          },
        },
        { requireProductionIOS: true },
      );

      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes('contains an unresolved Xcode build setting macro')),
      ).toBe(true);
    });
  });

  describe('iOS Bundle Identifier Validator', () => {
    it('accepts valid production reverse-DNS bundle identifier', () => {
      const res = validateIOSBundleId('com.vaultguard.app', { requireProduction: true });
      expect(res.valid).toBe(true);
      expect(res.validForProduction).toBe(true);
      expect(res.validForDebug).toBe(true);
      expect(res.hasUnresolvedMacro).toBe(false);
      expect(res.isPlaceholder).toBe(false);
      expect(res.errors).toHaveLength(0);
    });

    it('identifies unresolved Xcode macro and flags as valid for debug but invalid for production', () => {
      const res = validateIOSBundleId(
        'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
        { requireProduction: false },
      );
      expect(res.valid).toBe(true); // Does not break simulator/debug validation
      expect(res.validForDebug).toBe(true);
      expect(res.validForProduction).toBe(false);
      expect(res.hasUnresolvedMacro).toBe(true);
      expect(res.isPlaceholder).toBe(true);
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0]).toContain('contains an unresolved Xcode build setting macro');

      // Fails when production is required
      const prodRes = validateIOSBundleId(
        'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
        { requireProduction: true },
      );
      expect(prodRes.valid).toBe(false);
      expect(prodRes.errors).toHaveLength(1);
    });

    it('identifies default placeholder prefix and flags as invalid for production', () => {
      const res = validateIOSBundleId('org.reactjs.native.example.myapp', {
        requireProduction: true,
      });
      expect(res.valid).toBe(false);
      expect(res.isPlaceholder).toBe(true);
      expect(res.errors[0]).toContain('uses a default placeholder prefix');
    });

    it('rejects invalid syntax with spaces or illegal characters for both debug and production', () => {
      const res = validateIOSBundleId('invalid bundle id with spaces');
      expect(res.valid).toBe(false);
      expect(res.validForDebug).toBe(false);
      expect(res.validForProduction).toBe(false);
      expect(res.errors[0]).toContain('is not a valid reverse-DNS bundle identifier');
    });
  });
});
