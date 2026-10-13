import { ReleaseKitConfigSchema, type ReleaseKitConfig } from '../config/schema.js';
import { validateRequiredSecretNames } from './secrets.js';

export interface ConfigValidationResult {
  valid: boolean;
  config?: ReleaseKitConfig;
  errors: string[];
}

export function validateConfig(raw: unknown): ConfigValidationResult {
  const parseResult = ReleaseKitConfigSchema.safeParse(raw);
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    return {
      valid: false,
      errors,
    };
  }

  const config = parseResult.data;
  const secretErrors: string[] = [];

  const androidSecrets = [
    config.signing.android.keystoreSecretName,
    config.signing.android.keystorePasswordSecretName,
    config.signing.android.keyAliasSecretName,
    config.signing.android.keyPasswordSecretName,
  ];
  const androidSecretCheck = validateRequiredSecretNames(androidSecrets);
  if (!androidSecretCheck.valid) {
    secretErrors.push(...androidSecretCheck.errors);
  }

  const iosSecrets = [
    config.signing.ios.appStoreConnectKeyContentSecretName,
    config.signing.ios.appStoreConnectKeyIdSecretName,
    config.signing.ios.appStoreConnectIssuerIdSecretName,
  ];
  const iosSecretCheck = validateRequiredSecretNames(iosSecrets);
  if (!iosSecretCheck.valid) {
    secretErrors.push(...iosSecretCheck.errors);
  }

  if (secretErrors.length > 0) {
    return {
      valid: false,
      config,
      errors: secretErrors,
    };
  }

  return {
    valid: true,
    config,
    errors: [],
  };
}
