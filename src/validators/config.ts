import { ReleaseKitConfigSchema, type ReleaseKitConfig } from '../config/schema.js';
import { validateRequiredSecretNames } from './secrets.js';
import { hasUnresolvedXcodeMacro, isPlaceholderIOSBundleId } from '../detector/ios.js';

export interface ConfigValidationResult {
  valid: boolean;
  config?: ReleaseKitConfig;
  errors: string[];
  warnings?: string[];
}

export interface ValidateConfigOptions {
  requireProductionIOS?: boolean;
}

export interface IOSBundleIdValidationResult {
  valid: boolean;
  present: boolean;
  validForDebug: boolean;
  validForProduction: boolean;
  hasUnresolvedMacro: boolean;
  isPlaceholder: boolean;
  errors: string[];
  warnings: string[];
  remediation?: string;
}

const REVERSE_DNS_BUNDLE_ID_REGEX = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

/**
 * Validates an iOS Bundle Identifier for either debug/simulator validation or production App Store distribution.
 */
export function validateIOSBundleId(
  bundleId?: string,
  options: { requireProduction?: boolean } = {},
): IOSBundleIdValidationResult {
  const requireProduction = options.requireProduction ?? false;
  const trimmed = bundleId?.trim() || '';

  if (!trimmed) {
    const msg = 'iOS bundleId is not configured.';
    const remediation =
      'Set a concrete reverse-DNS Bundle Identifier (e.g. "com.company.app") in ios.bundleId in react-native-release.config.ts.';
    return {
      valid: !requireProduction,
      present: false,
      validForDebug: true,
      validForProduction: false,
      hasUnresolvedMacro: false,
      isPlaceholder: false,
      errors: requireProduction ? [msg] : [],
      warnings: requireProduction ? [] : [msg],
      remediation,
    };
  }

  const hasMacro = hasUnresolvedXcodeMacro(trimmed);
  const isPlaceholder = isPlaceholderIOSBundleId(trimmed);

  if (hasMacro) {
    const msg = `iOS bundleId "${trimmed}" contains an unresolved Xcode build setting macro.`;
    const remediation =
      'Replace the Xcode macro (e.g. "$(PRODUCT_NAME:rfc1034identifier)") with your concrete reverse-DNS Bundle Identifier (e.g. "com.company.app") in Xcode and in react-native-release.config.ts.';
    return {
      valid: !requireProduction,
      present: true,
      validForDebug: true,
      validForProduction: false,
      hasUnresolvedMacro: true,
      isPlaceholder: true,
      errors: requireProduction ? [msg] : [],
      warnings: requireProduction ? [] : [msg],
      remediation,
    };
  }

  if (!REVERSE_DNS_BUNDLE_ID_REGEX.test(trimmed)) {
    const msg = `iOS bundleId "${trimmed}" is not a valid reverse-DNS bundle identifier.`;
    const remediation =
      'Use a reverse-DNS identifier with at least two dot-separated segments containing only letters, numbers, hyphens, or underscores (e.g. "com.company.app").';
    return {
      valid: false,
      present: true,
      validForDebug: false,
      validForProduction: false,
      hasUnresolvedMacro: false,
      isPlaceholder: false,
      errors: [msg],
      warnings: [],
      remediation,
    };
  }

  if (isPlaceholder) {
    const msg = `iOS bundleId "${trimmed}" uses a default placeholder prefix and is not suitable for production App Store / TestFlight distribution.`;
    const remediation =
      'Configure your registered Apple Developer Bundle Identifier (e.g. "com.company.app") in ios.bundleId in react-native-release.config.ts.';
    return {
      valid: !requireProduction,
      present: true,
      validForDebug: true,
      validForProduction: false,
      hasUnresolvedMacro: false,
      isPlaceholder: true,
      errors: requireProduction ? [msg] : [],
      warnings: requireProduction ? [] : [msg],
      remediation,
    };
  }

  return {
    valid: true,
    present: true,
    validForDebug: true,
    validForProduction: true,
    hasUnresolvedMacro: false,
    isPlaceholder: false,
    errors: [],
    warnings: [],
  };
}

export function validateConfig(
  raw: unknown,
  options: ValidateConfigOptions = {},
): ConfigValidationResult {
  const parseResult = ReleaseKitConfigSchema.safeParse(raw);
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    return {
      valid: false,
      errors,
    };
  }

  const config = parseResult.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  const androidSecrets = [
    config.signing.android.keystoreSecretName,
    config.signing.android.keystorePathEnvName,
    config.signing.android.keystorePasswordSecretName,
    config.signing.android.keyAliasSecretName,
    config.signing.android.keyPasswordSecretName,
    config.signing.android.serviceAccountSecretName,
    config.signing.android.serviceAccountPathEnvName,
  ];
  const androidSecretCheck = validateRequiredSecretNames(androidSecrets);
  if (!androidSecretCheck.valid) {
    errors.push(...androidSecretCheck.errors);
  }

  const iosSecrets = [
    config.signing.ios.appStoreConnectKeyContentSecretName,
    config.signing.ios.appStoreConnectKeyIdSecretName,
    config.signing.ios.appStoreConnectIssuerIdSecretName,
    config.signing.ios.certificateSecretName,
    config.signing.ios.certificatePasswordSecretName,
    config.signing.ios.provisioningProfileSecretName,
  ].filter(Boolean) as string[];
  const iosSecretCheck = validateRequiredSecretNames(iosSecrets);
  if (!iosSecretCheck.valid) {
    errors.push(...iosSecretCheck.errors);
  }

  // Validate iOS bundleId if iOS is enabled and bundleId is provided (or if production iOS is required)
  if (config.ios.enabled && (config.ios.bundleId !== undefined || options.requireProductionIOS)) {
    const bundleCheck = validateIOSBundleId(config.ios.bundleId, {
      requireProduction: options.requireProductionIOS,
    });
    if (!bundleCheck.valid) {
      errors.push(...bundleCheck.errors);
    }
    if (bundleCheck.warnings.length > 0) {
      warnings.push(...bundleCheck.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    config,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
