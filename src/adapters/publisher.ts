import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ReleaseKitConfig, AndroidTrack, AndroidReleaseStatus } from '../config/schema.js';
import { SUPPORTED_ANDROID_TRACKS, locateBuiltArtifact } from './android.js';
import { detectAndroid } from '../detector/android.js';
import { validateRequiredSecretNames } from '../validators/secrets.js';
import { safeExec } from '../utils/process.js';
import { maskSecrets, registerSecretForRedaction } from '../utils/logger.js';
import { readFileUtf8 } from '../utils/fs.js';

export type PublishErrorCategory =
  | 'validation'
  | 'production-safeguard'
  | 'missing-credentials'
  | 'missing-fastlane'
  | 'version-conflict'
  | 'authentication'
  | 'permissions'
  | 'first-upload-required'
  | 'invalid-artifact'
  | 'unknown';

export interface PublishOptions {
  platform: 'android' | 'ios';
  track?: string;
  releaseStatus?: AndroidReleaseStatus;
  artifactPath?: string;
  appModule?: string;
  flavor?: string;
  confirmProduction?: boolean;
  dryRun?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface PublishResult {
  success: boolean;
  platform: 'android' | 'ios';
  track: string;
  releaseStatus?: AndroidReleaseStatus;
  artifactPath?: string;
  applicationId?: string;
  errorCategory?: PublishErrorCategory;
  message: string;
  remediation?: string;
  stdout?: string;
  stderr?: string;
}

export interface ServiceAccountValidationResult {
  valid: boolean;
  mode: 'file' | 'inline-json' | 'base64-json' | 'none';
  clientEmail?: string;
  errors: string[];
  remediations: string[];
}

function parseServiceAccountJson(raw: string): {
  valid: boolean;
  mode: 'inline-json' | 'base64-json' | 'none';
  jsonString?: string;
  clientEmail?: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, mode: 'none', error: 'Service account credential value is empty.' };
  }

  let candidateJson = trimmed;
  let mode: 'inline-json' | 'base64-json' = 'inline-json';

  if (!trimmed.startsWith('{')) {
    try {
      const decoded = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf-8');
      if (decoded.trim().startsWith('{')) {
        candidateJson = decoded.trim();
        mode = 'base64-json';
      } else {
        return {
          valid: false,
          mode: 'none',
          error: 'Value is neither a valid JSON object nor base64-encoded JSON.',
        };
      }
    } catch {
      return {
        valid: false,
        mode: 'none',
        error: 'Failed to decode service account JSON content.',
      };
    }
  }

  try {
    const parsed = JSON.parse(candidateJson) as Record<string, unknown>;
    if (parsed.type !== 'service_account') {
      return {
        valid: false,
        mode,
        error: 'JSON does not have `"type": "service_account"`.',
      };
    }
    if (typeof parsed.client_email !== 'string' || !parsed.client_email.includes('@')) {
      return {
        valid: false,
        mode,
        error: 'Service account JSON is missing a valid "client_email" field.',
      };
    }
    if (typeof parsed.private_key !== 'string' || !parsed.private_key.includes('PRIVATE KEY')) {
      return {
        valid: false,
        mode,
        error: 'Service account JSON is missing a valid "private_key" field.',
      };
    }

    // Register private key and raw secret for automatic log redaction
    registerSecretForRedaction(parsed.private_key);
    registerSecretForRedaction(trimmed);

    return {
      valid: true,
      mode,
      jsonString: candidateJson,
      clientEmail: parsed.client_email,
    };
  } catch {
    return {
      valid: false,
      mode: 'none',
      error: 'Service account credential is not valid JSON.',
    };
  }
}

/**
 * Validates Google Play Service Account credentials from environment variables or file path without leaking values.
 */
export async function validateServiceAccountCredentials(
  config: ReleaseKitConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServiceAccountValidationResult> {
  const signingCfg = config.signing.android;
  const errors: string[] = [];
  const remediations: string[] = [];

  const secretCheck = validateRequiredSecretNames([
    signingCfg.serviceAccountSecretName,
    signingCfg.serviceAccountPathEnvName,
  ]);

  if (!secretCheck.valid) {
    return {
      valid: false,
      mode: 'none',
      errors: secretCheck.errors,
      remediations: [
        'Use SCREAMING_SNAKE_CASE environment variable names for serviceAccountSecretName and serviceAccountPathEnvName.',
      ],
    };
  }

  const filePathVal =
    env[signingCfg.serviceAccountPathEnvName]?.trim() || env.SUPPLY_JSON_KEY?.trim();
  const inlineVal =
    env[signingCfg.serviceAccountSecretName]?.trim() || env.SUPPLY_JSON_KEY_DATA?.trim();

  if (filePathVal) {
    const resolved = path.resolve(filePathVal);
    if (!existsSync(resolved)) {
      errors.push(
        `Google Play service account file specified in ${signingCfg.serviceAccountPathEnvName} does not exist at: ${resolved}`,
      );
      remediations.push(
        `Verify the path in ${signingCfg.serviceAccountPathEnvName} points to a valid Google Cloud Service Account JSON key file.`,
      );
      return { valid: false, mode: 'file', errors, remediations };
    }

    try {
      const fileContent = await readFileUtf8(resolved);
      const parsed = parseServiceAccountJson(fileContent);
      if (!parsed.valid) {
        errors.push(`Invalid Google Play service account file at ${resolved}: ${parsed.error}`);
        remediations.push(
          'Download a valid Service Account JSON key from Google Cloud Console with Google Play Android Developer API access.',
        );
        return { valid: false, mode: 'file', errors, remediations };
      }

      return {
        valid: true,
        mode: 'file',
        clientEmail: parsed.clientEmail,
        errors: [],
        remediations: [],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Unable to read Google Play service account file at ${resolved}: ${msg}`);
      remediations.push('Check file permissions on the service account JSON key file.');
      return { valid: false, mode: 'file', errors, remediations };
    }
  }

  if (inlineVal) {
    registerSecretForRedaction(inlineVal);
    const parsed = parseServiceAccountJson(inlineVal);
    if (!parsed.valid) {
      errors.push(
        `Invalid Google Play service account JSON in ${signingCfg.serviceAccountSecretName}: ${parsed.error}`,
      );
      remediations.push(
        `Ensure ${signingCfg.serviceAccountSecretName} contains the complete Google Cloud Service Account JSON (raw or base64-encoded).`,
      );
      return { valid: false, mode: parsed.mode, errors, remediations };
    }

    return {
      valid: true,
      mode: parsed.mode,
      clientEmail: parsed.clientEmail,
      errors: [],
      remediations: [],
    };
  }

  errors.push(
    `Missing Google Play service account credentials. Neither ${signingCfg.serviceAccountSecretName} nor ${signingCfg.serviceAccountPathEnvName} is set in the environment.`,
  );
  remediations.push(
    `Set ${signingCfg.serviceAccountPathEnvName}="/path/to/service-account.json" locally, or configure ${signingCfg.serviceAccountSecretName} in GitHub Actions secrets.`,
  );

  return {
    valid: false,
    mode: 'none',
    errors,
    remediations,
  };
}

export interface ProvisionedServiceAccount {
  jsonKeyPath: string;
  isTemporary: boolean;
  cleanup: () => Promise<void>;
}

export async function provisionServiceAccountKey(
  config: ReleaseKitConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProvisionedServiceAccount> {
  const signingCfg = config.signing.android;
  const filePathVal =
    env[signingCfg.serviceAccountPathEnvName]?.trim() || env.SUPPLY_JSON_KEY?.trim();
  const inlineVal =
    env[signingCfg.serviceAccountSecretName]?.trim() || env.SUPPLY_JSON_KEY_DATA?.trim();

  if (filePathVal) {
    return {
      jsonKeyPath: path.resolve(filePathVal),
      isTemporary: false,
      cleanup: async () => {},
    };
  }

  if (inlineVal) {
    const parsed = parseServiceAccountJson(inlineVal);
    if (!parsed.valid || !parsed.jsonString) {
      throw new Error(parsed.error || 'Invalid service account JSON');
    }
    const tempPath = path.join(
      tmpdir(),
      `rn-release-play-sa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`,
    );
    await fs.writeFile(tempPath, parsed.jsonString, { mode: 0o600 });
    let exitHook: (() => void) | undefined = () => {
      try {
        if (existsSync(tempPath)) {
          rmSync(tempPath, { force: true });
        }
      } catch {
        // Ignore exit hook cleanup errors
      }
    };
    process.once('exit', exitHook);
    process.once('SIGINT', exitHook);
    process.once('SIGTERM', exitHook);

    return {
      jsonKeyPath: tempPath,
      isTemporary: true,
      cleanup: async () => {
        if (exitHook) {
          process.removeListener('exit', exitHook);
          process.removeListener('SIGINT', exitHook);
          process.removeListener('SIGTERM', exitHook);
          exitHook = undefined;
        }
        try {
          await fs.rm(tempPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  }

  throw new Error('No service account credential found to provision.');
}

/**
 * Classifies Fastlane / Google Play API error messages into actionable categories and remediation steps.
 */
export interface ClassifyPlayStoreErrorOptions {
  appModule?: string;
}

export function classifyPlayStoreError(
  output: string,
  options: ClassifyPlayStoreErrorOptions = {},
): {
  category: PublishErrorCategory;
  summary: string;
  remediation: string;
} {
  const lower = output.toLowerCase();
  const appModule = options.appModule || 'app';

  if (
    lower.includes('apkupgradeversionconflict') ||
    lower.includes('already been used') ||
    lower.includes('version code')
  ) {
    return {
      category: 'version-conflict',
      summary: 'Google Play rejected the upload because the versionCode has already been used.',
      remediation: `Increment "versionCode" in android/${appModule}/build.gradle (every Google Play upload requires a strictly higher integer versionCode), rebuild the release artifact, and retry.`,
    };
  }

  if (
    lower.includes('invalid_grant') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid jwt') ||
    lower.includes('status code 401') ||
    lower.includes('unauthenticated')
  ) {
    return {
      category: 'authentication',
      summary: 'Google Play API authentication failed for the configured Service Account.',
      remediation:
        'Verify that your Google Cloud Service Account JSON key is active, not revoked, and that the Google Play Android Developer API is enabled in your Google Cloud project.',
    };
  }

  if (
    lower.includes('caller does not have permission') ||
    lower.includes('permission_denied') ||
    lower.includes('status code 403') ||
    lower.includes('forbidden')
  ) {
    return {
      category: 'permissions',
      summary:
        'The Service Account does not have permission to publish to this Google Play application or track.',
      remediation:
        'In Google Play Console -> Users and permissions, invite the Service Account email and grant "Release to production, exclude devices, and use Play App Signing" and "Manage testing tracks" permissions.',
    };
  }

  if (
    lower.includes('applicationnotfound') ||
    lower.includes('package not found') ||
    lower.includes('no application was found')
  ) {
    return {
      category: 'first-upload-required',
      summary: 'The application package was not found in Google Play Console.',
      remediation:
        'Google Play requires the very first APK/AAB for a new app to be uploaded manually via the Google Play Console web UI before automated API publishing can be used.',
    };
  }

  if (
    lower.includes('unsigned') ||
    lower.includes('certificate') ||
    lower.includes('sha1') ||
    lower.includes('wrong package name') ||
    lower.includes('upload certificate')
  ) {
    return {
      category: 'invalid-artifact',
      summary:
        'Google Play rejected the artifact due to a signing certificate or applicationId mismatch.',
      remediation:
        'Ensure your release build is signed with the exact Upload Key keystore registered under Play App Signing in Google Play Console.',
    };
  }

  return {
    category: 'unknown',
    summary: 'Fastlane supply failed while uploading to Google Play.',
    remediation:
      'Review the sanitized Fastlane output above and verify your Google Play Console release track status (e.g. draft apps require releaseStatus: "draft").',
  };
}

export class PublisherAdapter {
  constructor(private config: ReleaseKitConfig) {}

  public async publish(options: PublishOptions): Promise<PublishResult> {
    if (options.platform === 'ios') {
      return {
        success: false,
        platform: 'ios',
        track: options.track || 'testflight',
        errorCategory: 'validation',
        message:
          'Local iOS store deployment via CLI is not supported in this version. Use the generated GitHub Actions workflow (.github/workflows/release-tag.yml) with App Store Connect credentials to deploy to TestFlight.',
        remediation:
          'Run "npx react-native-release-kit setup" to generate the release workflow, configure your Apple distribution certificate, provisioning profile, and App Store Connect secrets in GitHub repository secrets.',
      };
    }

    return this.publishAndroid(options);
  }

  public async publishAndroid(options: PublishOptions): Promise<PublishResult> {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const rawTrack = options.track ?? this.config.android.deploymentTrack ?? 'internal';
    const releaseStatus: AndroidReleaseStatus =
      options.releaseStatus ?? this.config.android.releaseStatus ?? 'draft';

    // 1. Validate Track
    if (!SUPPORTED_ANDROID_TRACKS.includes(rawTrack as AndroidTrack)) {
      return {
        success: false,
        platform: 'android',
        track: rawTrack,
        releaseStatus,
        errorCategory: 'validation',
        message: `Unsupported Google Play track "${rawTrack}". Supported tracks: ${SUPPORTED_ANDROID_TRACKS.join(', ')}.`,
        remediation: 'Use "--track internal", "--track closed", or "--track production".',
      };
    }

    const track = rawTrack as AndroidTrack;

    // 2. Production Track Safeguard
    const isProductionConfirmed =
      options.confirmProduction === true || this.config.android.allowProductionPublish === true;

    if (track === 'production' && !isProductionConfirmed) {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        errorCategory: 'production-safeguard',
        message:
          'Production track publishing is blocked by default to prevent accidental store rollouts.',
        remediation:
          'Pass "--confirm-production" on the CLI or set "android.allowProductionPublish: true" in react-native-release.config.ts to authorize production deployment.',
      };
    }

    // 3. Detect Android project & applicationId
    const packagePath = this.config.android.packagePath || 'android';
    const androidDir = path.resolve(cwd, packagePath);
    const appModule = options.appModule ?? this.config.android.appModule ?? 'app';
    const flavor = options.flavor ?? this.config.android.flavor;

    const detection = await detectAndroid(cwd, { packagePath, appModule });
    const applicationId = this.config.android.applicationId || detection.applicationId;

    if (!applicationId) {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        errorCategory: 'validation',
        message:
          'Could not determine Android applicationId (package name) from configuration or build.gradle.',
        remediation:
          'Set "android.applicationId" (e.g. "com.company.app") in react-native-release.config.ts.',
      };
    }

    if (detection.usesDebugSigningInRelease) {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        applicationId,
        errorCategory: 'validation',
        message: `Unsafe Android release signing detected: application module "${appModule}" uses debug signing (signingConfigs.debug) for release builds in build.gradle. Google Play strictly rejects release artifacts signed with debug keys.`,
        remediation: `Configure a dedicated release signingConfig in android/${appModule}/build.gradle backed by environment variables (e.g. ANDROID_KEYSTORE_PATH) or Gradle properties before publishing.`,
      };
    }

    if (track === 'production') {
      if (!detection.buildGradleFound) {
        return {
          success: false,
          platform: 'android',
          track,
          releaseStatus,
          applicationId,
          errorCategory: 'validation',
          message:
            'Cannot publish to Google Play production track: Android Gradle configuration could not be detected.',
          remediation: `Ensure android/${appModule}/build.gradle exists and contains valid Gradle configuration.`,
        };
      }
      if (!detection.hasReleaseSigningConfig && !detection.hasSigningConfigEnv) {
        return {
          success: false,
          platform: 'android',
          track,
          releaseStatus,
          applicationId,
          errorCategory: 'validation',
          message: `Cannot publish to Google Play production track: no release signing configuration detected in android/${appModule}/build.gradle.`,
          remediation: `Configure a dedicated release signingConfig in android/${appModule}/build.gradle backed by environment variables (e.g. ANDROID_KEYSTORE_PATH) before publishing to production.`,
        };
      }
    }

    // 4. Validate Artifact before publishing
    let artifactPath = options.artifactPath ? path.resolve(cwd, options.artifactPath) : undefined;

    if (!artifactPath) {
      const located = locateBuiltArtifact(androidDir, {
        appModule: detection.appModule || appModule,
        artifact: this.config.android.buildArtifact ?? 'aab',
        variant: 'release',
        flavor,
      });
      if (located.found && located.artifactPath) {
        artifactPath = located.artifactPath;
      }
    }

    if (!artifactPath || !existsSync(artifactPath)) {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        applicationId,
        errorCategory: 'validation',
        message: options.artifactPath
          ? `Specified Android artifact does not exist at: ${artifactPath}`
          : `No built Android release ${this.config.android.buildArtifact.toUpperCase()} artifact was found in ${path.join(androidDir, appModule, 'build/outputs')}.`,
        remediation:
          'Build the release artifact first with "npx react-native-release-kit build --platform android --variant release", or provide an explicit path via "--artifact-path <file>".',
      };
    }

    const ext = path.extname(artifactPath).toLowerCase();
    if (ext !== '.aab' && ext !== '.apk') {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        artifactPath,
        applicationId,
        errorCategory: 'validation',
        message: `Invalid artifact extension "${ext}" for ${artifactPath}. Expected ".aab" or ".apk".`,
        remediation: 'Provide a valid Android App Bundle (.aab) or APK (.apk) file.',
      };
    }

    try {
      const stat = statSync(artifactPath);
      if (!stat.isFile() || stat.size === 0) {
        return {
          success: false,
          platform: 'android',
          track,
          releaseStatus,
          artifactPath,
          applicationId,
          errorCategory: 'validation',
          message: `Artifact at ${artifactPath} is empty (0 bytes) or not a regular file.`,
          remediation: 'Rebuild your release artifact and verify Gradle output integrity.',
        };
      }
    } catch {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        artifactPath,
        applicationId,
        errorCategory: 'validation',
        message: `Unable to stat artifact file at ${artifactPath}.`,
        remediation: 'Check file permissions and path validity.',
      };
    }

    // 5. Validate Service Account Credentials
    const saValidation = await validateServiceAccountCredentials(this.config, env);
    if (!saValidation.valid) {
      return {
        success: false,
        platform: 'android',
        track,
        releaseStatus,
        artifactPath,
        applicationId,
        errorCategory: 'missing-credentials',
        message: saValidation.errors.join(' '),
        remediation: saValidation.remediations.join(' '),
      };
    }

    // 6. Dry-Run Support (Validates everything without uploading to Google Play)
    if (options.dryRun) {
      return {
        success: true,
        platform: 'android',
        track,
        releaseStatus,
        artifactPath,
        applicationId,
        message: `[DRY RUN] Validated ${path.basename(artifactPath)} for Google Play "${track}" track (releaseStatus: ${releaseStatus}, package: ${applicationId}). No upload performed.`,
      };
    }

    // 7. Verify Fastlane availability
    const hasGemfile =
      existsSync(path.join(cwd, 'Gemfile')) || existsSync(path.join(androidDir, 'Gemfile'));
    let fastlaneCmd = 'fastlane';
    let fastlaneBaseArgs: string[] = [];

    if (hasGemfile) {
      const bundleCheck = await safeExec('bundle', ['exec', 'fastlane', '--version'], {
        cwd,
        env,
        silent: true,
      });
      if (bundleCheck.exitCode === 0) {
        fastlaneCmd = 'bundle';
        fastlaneBaseArgs = ['exec', 'fastlane'];
      }
    }

    if (fastlaneCmd === 'fastlane') {
      const directCheck = await safeExec('fastlane', ['--version'], {
        cwd,
        env,
        silent: true,
      });
      if (directCheck.exitCode !== 0) {
        return {
          success: false,
          platform: 'android',
          track,
          releaseStatus,
          artifactPath,
          applicationId,
          errorCategory: 'missing-fastlane',
          message: 'Fastlane is not installed or not available in PATH.',
          remediation:
            'Install Fastlane via Ruby Bundler (recommended: add `gem "fastlane"` to your Gemfile and run `bundle install`) or via Homebrew (`brew install fastlane`).',
        };
      }
    }

    // 8. Provision Service Account Key and Execute Fastlane Supply
    const provisionedSa = await provisionServiceAccountKey(this.config, env);
    try {
      const artifactFlag = ext === '.aab' ? '--aab' : '--apk';
      // Map 'closed' track to Google Play's 'alpha' closed testing track name if needed by supply, or pass track directly
      const supplyArgs = [
        ...fastlaneBaseArgs,
        'supply',
        artifactFlag,
        artifactPath,
        '--track',
        track,
        '--release_status',
        releaseStatus,
        '--package_name',
        applicationId,
        '--json_key',
        provisionedSa.jsonKeyPath,
        '--skip_upload_metadata',
        'true',
        '--skip_upload_images',
        'true',
        '--skip_upload_screenshots',
        'true',
      ];

      const execRes = await safeExec(fastlaneCmd, supplyArgs, {
        cwd,
        env: {
          ...env,
          SUPPLY_JSON_KEY: provisionedSa.jsonKeyPath,
        },
        timeout: options.timeoutMs ?? 15 * 60 * 1000,
      });

      const sanitizedStdout = maskSecrets(execRes.stdout);
      const sanitizedStderr = maskSecrets(execRes.stderr);

      if (execRes.exitCode !== 0) {
        const combinedOutput = `${sanitizedStderr}\n${sanitizedStdout}`;
        const classified = classifyPlayStoreError(combinedOutput, { appModule });
        return {
          success: false,
          platform: 'android',
          track,
          releaseStatus,
          artifactPath,
          applicationId,
          errorCategory: classified.category,
          message: classified.summary,
          remediation: classified.remediation,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
        };
      }

      return {
        success: true,
        platform: 'android',
        track,
        releaseStatus,
        artifactPath,
        applicationId,
        message: `Successfully uploaded ${path.basename(artifactPath)} to Google Play "${track}" track (releaseStatus: ${releaseStatus}).`,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
      };
    } finally {
      await provisionedSa.cleanup();
    }
  }
}
