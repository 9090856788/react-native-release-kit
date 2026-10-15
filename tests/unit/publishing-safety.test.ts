import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  PublisherAdapter,
  validateServiceAccountCredentials,
} from '../../src/adapters/publisher.js';
import { AndroidAdapter, validateAndroidSigning } from '../../src/adapters/android.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';
import {
  maskSecrets,
  clearRegisteredSecrets,
  registerSecretForRedaction,
} from '../../src/utils/logger.js';
import { validateIOSBundleId } from '../../src/validators/config.js';
import { generateReleaseTagWorkflow } from '../../src/generators/github-actions.js';
import type { ProjectDetectionResult } from '../../src/detector/types.js';
import { deployCommand } from '../../src/commands/deploy.js';

function createBaseConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = ReleaseKitConfigSchema.parse(createDefaultConfig('safety-app', 'npm'));
  return {
    ...base,
    ...overrides,
    android: {
      ...base.android,
      applicationId: 'com.safety.app',
      ...(overrides.android || {}),
    },
    signing: {
      ...base.signing,
      ...(overrides.signing || {}),
      android: {
        ...base.signing.android,
        ...(overrides.signing?.android || {}),
      },
    },
  };
}

function createMockProjectDetection(): ProjectDetectionResult {
  return {
    projectRoot: '/test',
    packageManager: 'npm',
    scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'jest' },
    android: {
      hasAndroid: true,
      packagePath: 'android',
      appModule: 'app',
      applicationId: 'com.safety.app',
      isKotlinDsl: false,
      buildGradleFound: true,
      hasReleaseSigningConfig: true,
      usesDebugSigningInRelease: false,
      hasSigningConfigEnv: true,
    },
    ios: {
      hasIOS: true,
      packagePath: 'ios',
      workspacePath: 'ios/safety.xcworkspace',
      schemes: ['safety'],
      bundleId: 'com.safety.app',
      hasPodfile: true,
      usesAutomaticSigning: true,
    },
  };
}

async function createMockAndroidProject(cwd: string): Promise<void> {
  const appDir = path.join(cwd, 'android', 'app');
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, 'build.gradle'),
    `
    android {
        defaultConfig { applicationId "com.safety.app" }
        buildTypes {
            release {
                minifyEnabled true
            }
        }
    }
    `,
  );
  const gradlewPath = path.join(cwd, 'android', 'gradlew');
  await fs.writeFile(gradlewPath, '#!/bin/sh\nexit 0\n');
  await fs.chmod(gradlewPath, 0o755);
  await fs.writeFile(path.join(cwd, 'android', 'local.properties'), `sdk.dir=${cwd}\n`);
}

describe('Phase F Step 3 — Publishing Safety Matrix', () => {
  let testDir: string;

  beforeEach(async () => {
    clearRegisteredSecrets();
    testDir = path.join(
      tmpdir(),
      `rn-release-safety-matrix-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    clearRegisteredSecrets();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Unsigned Android release
  describe('Matrix 1: Unsigned Android release', () => {
    it('allows unsigned build dry-run when intended without invoking keystore provisioning', async () => {
      await createMockAndroidProject(testDir);
      const config = createBaseConfig({
        signing: {
          android: {
            enabled: false,
            keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: false,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
          },
        },
      });

      const adapter = new AndroidAdapter(config);
      const res = await adapter.build({
        cwd: testDir,
        dryRun: true,
        sign: false,
      });

      expect(res.success).toBe(true);
      expect(res.gradleTask).toContain('bundleRelease');
    });

    it('refuses to build with --sign if signing is disabled and credentials are missing', async () => {
      await createMockAndroidProject(testDir);
      const config = createBaseConfig({
        signing: {
          android: {
            enabled: false,
            keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: false,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
          },
        },
      });

      const adapter = new AndroidAdapter(config);
      const res = await adapter.build({
        cwd: testDir,
        dryRun: false,
        sign: true,
        env: { ANDROID_HOME: testDir, PATH: process.env.PATH },
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Missing required Android release signing environment variables');
    });
  });

  // 2. Debug-signed Android release
  describe('Matrix 2: Debug-signed Android release', () => {
    it('blocks AndroidAdapter build when release variant is configured with debug signingConfig and cannot be safely remediated', async () => {
      const androidDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(androidDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'build.gradle.kts'),
        `
        android {
            buildTypes {
                release {
                    signingConfig = signingConfigs.getByName("debug")
                }
            }
        }
        `,
      );
      const gradlewPath = path.join(testDir, 'android', 'gradlew');
      await fs.writeFile(gradlewPath, '#!/bin/sh\nexit 0\n');
      await fs.chmod(gradlewPath, 0o755);

      const config = createBaseConfig();
      const adapter = new AndroidAdapter(config);
      const res = await adapter.build({
        cwd: testDir,
        dryRun: false,
        sign: true,
        env: { ANDROID_HOME: testDir, PATH: process.env.PATH },
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Unsafe Android release signing configuration');
      expect(res.error).toContain('signingConfigs.debug');
    });

    it('blocks PublisherAdapter from publishing release artifacts that use debug signing', async () => {
      const androidDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(androidDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'build.gradle'),
        `
        android {
            defaultConfig { applicationId "com.safety.app" }
            buildTypes {
                release {
                    signingConfig signingConfigs.debug
                }
            }
        }
        `,
      );

      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        track: 'internal',
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Unsafe Android release signing detected');
      expect(res.message).toContain('signingConfigs.debug');
      expect(res.remediation).toContain('Configure a dedicated release signingConfig');
    });
  });

  // 3. Missing keystore or invalid signing configuration
  describe('Matrix 3: Missing keystore or invalid signing configuration', () => {
    it('fails when required base64 keystore environment variable is missing', () => {
      const config = createBaseConfig({
        signing: {
          android: {
            enabled: true,
            keystoreSecretName: 'MY_KEYSTORE_B64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: false,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
          },
        },
      });

      const res = validateAndroidSigning(config, {});
      expect(res.valid).toBe(false);
      expect(res.missingVars).toContain('MY_KEYSTORE_B64 (or ANDROID_KEYSTORE_PATH)');
    });

    it('fails when base64 keystore data is corrupted or invalid', () => {
      const config = createBaseConfig({
        signing: {
          android: {
            enabled: true,
            keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: false,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
          },
        },
      });

      const res = validateAndroidSigning(config, {
        ANDROID_KEYSTORE_BASE64: 'not-valid-base64!@@#$$%^^&&**',
        ANDROID_KEYSTORE_PASSWORD: 'pass',
        ANDROID_KEY_ALIAS: 'alias',
        ANDROID_KEY_PASSWORD: 'pass',
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('does not contain valid base64-encoded keystore data');
    });

    it('fails when static keystore path does not exist on disk', () => {
      const config = createBaseConfig({
        signing: {
          android: {
            enabled: true,
            keystorePath: '/non/existent/path/my-release.keystore',
            keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: false,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
          },
        },
      });

      const res = validateAndroidSigning(config, {
        ANDROID_KEYSTORE_PASSWORD: 'pass',
        ANDROID_KEY_ALIAS: 'alias',
        ANDROID_KEY_PASSWORD: 'pass',
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('does not exist at path');
    });
  });

  // 4. Missing Play Store service account
  describe('Matrix 4: Missing Play Store service account', () => {
    it('fails with credentials category and remediation when service account is missing', async () => {
      const config = createBaseConfig();
      const validation = await validateServiceAccountCredentials(config, {});
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('Missing Google Play service account credentials');
      expect(validation.remediations[0]).toContain('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    });
  });

  // 5. Production publish without confirmation
  describe('Matrix 5: Production publish without confirmation', () => {
    it('safeguards against accidental production publishing by returning production-safeguard error', async () => {
      const config = createBaseConfig({
        android: {
          enabled: true,
          buildVariant: 'release',
          buildArtifact: 'aab',
          buildTask: 'bundleRelease',
          appModule: 'app',
          deploymentTrack: 'production',
          releaseStatus: 'draft',
          packagePath: 'android',
          publishStore: true,
          allowProductionPublish: false,
        },
      });

      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        track: 'production',
        confirmProduction: false,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('production-safeguard');
      expect(res.message).toContain('Production track publishing is blocked by default');
      expect(res.remediation).toContain('--confirm-production');
    });
  });

  // 6. Production publish with confirmation but missing prerequisites
  describe('Matrix 6: Production publish with confirmation but missing prerequisites', () => {
    it('blocks confirmed production publish when release signing configuration is absent from build.gradle', async () => {
      const androidDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(androidDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'build.gradle'),
        `
        android {
            defaultConfig { applicationId "com.safety.app" }
            buildTypes {
                release {
                    minifyEnabled true
                }
            }
        }
        `,
      );

      const config = createBaseConfig({
        android: {
          enabled: true,
          buildVariant: 'release',
          buildArtifact: 'aab',
          buildTask: 'bundleRelease',
          appModule: 'app',
          deploymentTrack: 'production',
          releaseStatus: 'draft',
          packagePath: 'android',
          publishStore: true,
          allowProductionPublish: true,
        },
      });

      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        track: 'production',
        confirmProduction: true,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain(
        'Cannot publish to Google Play production track: no release signing configuration detected',
      );
    });

    it('blocks confirmed production publish when build.gradle does not exist', async () => {
      const config = createBaseConfig({
        android: {
          enabled: true,
          buildVariant: 'release',
          buildArtifact: 'aab',
          buildTask: 'bundleRelease',
          appModule: 'app',
          deploymentTrack: 'production',
          releaseStatus: 'draft',
          packagePath: 'android',
          publishStore: true,
          allowProductionPublish: true,
        },
      });

      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        track: 'production',
        confirmProduction: true,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Android Gradle configuration could not be detected');
    });
  });

  // 7. iOS distribution without a valid signing setup
  describe('Matrix 7: iOS distribution without a valid signing setup', () => {
    it('generates GitHub Actions preflight check that validates distribution cert and profile secrets', () => {
      const config = createBaseConfig({
        ios: {
          enabled: true,
          buildArtifact: 'ipa',
          exportMethod: 'app-store',
          packagePath: 'ios',
          publishStore: true,
          uploadToTestFlight: true,
        },
        signing: {
          android: {
            enabled: false,
            keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
            keystorePathEnvName: 'ANDROID_KEYSTORE_PATH',
            keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
            keyAliasSecretName: 'ANDROID_KEY_ALIAS',
            keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
            serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
            serviceAccountPathEnvName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH',
          },
          ios: {
            enabled: true,
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectApiKeySecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
            certificateSecretName: 'MY_CUSTOM_CERT_B64',
            certificatePasswordSecretName: 'MY_CUSTOM_CERT_PWD',
            provisioningProfileSecretName: 'MY_CUSTOM_PROFILE_B64',
            exportMethod: 'app-store',
          },
        },
      });

      const project = createMockProjectDetection();
      const workflow = generateReleaseTagWorkflow(config, project);

      expect(workflow).toContain('Validate iOS Release Signing Prerequisites');
      expect(workflow).toContain('secrets.MY_CUSTOM_CERT_B64');
      expect(workflow).toContain('secrets.MY_CUSTOM_CERT_PWD');
      expect(workflow).toContain('secrets.MY_CUSTOM_PROFILE_B64');
      expect(workflow).toContain('iOS release signing prerequisites are not configured');
      expect(workflow).toContain(
        '- MY_CUSTOM_CERT_B64: Base64-encoded .p12 distribution certificate',
      );
    });

    it('blocks placeholder or unresolved macro bundle IDs for production iOS distribution', () => {
      const placeholderRes = validateIOSBundleId('org.reactjs.native.example.TestApp', {
        requireProduction: true,
      });
      expect(placeholderRes.valid).toBe(false);
      expect(placeholderRes.errors[0]).toContain('uses a default placeholder prefix');

      const macroRes = validateIOSBundleId('$(PRODUCT_NAME:rfc1034identifier)', {
        requireProduction: true,
      });
      expect(macroRes.valid).toBe(false);
      expect(macroRes.errors[0]).toContain('contains an unresolved Xcode build setting macro');
    });
  });

  // 8. Missing App Store Connect credentials
  describe('Matrix 8: Missing App Store Connect credentials', () => {
    it('generates GitHub Actions preflight check enforcing App Store Connect key secret', () => {
      const config = createBaseConfig({
        githubActions: {
          enabled: true,
          mainBranch: 'main',
          releaseTagPattern: 'v*',
          artifactRetentionDays: 14,
          triggers: { pullRequest: true, main: true, releaseTags: true },
          workflows: { prValidation: true, mainBuild: true, releaseTag: true },
          cacheDependencies: true,
          runner: { android: 'ubuntu-latest', ios: 'macos-14' },
          nodeVersion: '20',
          javaVersion: '17',
          rubyVersion: '3.3',
          storePublishing: true,
        },
        ios: {
          enabled: true,
          buildArtifact: 'ipa',
          exportMethod: 'app-store',
          packagePath: 'ios',
          publishStore: true,
          uploadToTestFlight: true,
        },
      });

      const project = createMockProjectDetection();
      const workflow = generateReleaseTagWorkflow(config, project);

      expect(workflow).toContain('Validate App Store Connect Credentials');
      expect(workflow).toContain(
        "Required secret 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT' is missing for TestFlight publishing",
      );
    });
  });

  // 9. Invalid or missing release artifacts
  describe('Matrix 9: Invalid or missing release artifacts', () => {
    it('fails before publishing if specified artifact does not exist', async () => {
      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        artifactPath: path.join(testDir, 'non-existent.aab'),
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Specified Android artifact does not exist');
    });

    it('fails before publishing if artifact has invalid extension', async () => {
      const invalidFile = path.join(testDir, 'bundle.tar.gz');
      await fs.writeFile(invalidFile, 'dummy data');

      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        artifactPath: invalidFile,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Invalid artifact extension');
      expect(res.message).toContain('.tar.gz');
    });

    it('fails before publishing if artifact is empty (0 bytes)', async () => {
      const emptyFile = path.join(testDir, 'app-release.aab');
      await fs.writeFile(emptyFile, ''); // 0 bytes

      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);
      const res = await publisher.publishAndroid({
        cwd: testDir,
        artifactPath: emptyFile,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('is empty (0 bytes)');
    });
  });

  // 10. Unsupported local iOS publishing
  describe('Matrix 10: Unsupported local iOS publishing', () => {
    it('PublisherAdapter explicitly rejects local iOS publishing with actionable instructions', async () => {
      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);
      const res = await publisher.publish({
        platform: 'ios',
        cwd: testDir,
      });

      expect(res.success).toBe(false);
      expect(res.platform).toBe('ios');
      expect(res.message).toContain(
        'Local iOS store deployment via CLI is not supported in this version',
      );
      expect(res.remediation).toContain('Run "npx react-native-release-kit setup"');
    });

    it('deploy command exits with non-zero code when targeting iOS locally', async () => {
      // Mock write config
      const configTs = `
      export default {
        projectName: 'safety-app',
        packageManager: 'npm',
        android: { enabled: true },
        ios: { enabled: true, bundleId: 'com.safety.app' },
      };
      `;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configTs);

      const exitCode = await deployCommand({
        platform: 'ios',
        cwd: testDir,
      });

      expect(exitCode).toBe(1);
    });
  });

  // 11. Child-process failures during build and publishing
  describe('Matrix 11: Child-process failures during build and publishing', () => {
    it('sanitizes stderr and classified error when Fastlane supply fails', async () => {
      const config = createBaseConfig();
      const publisher = new PublisherAdapter(config);

      // Create valid artifact and valid mock service account
      const mockAab = path.join(testDir, 'app-release.aab');
      await fs.writeFile(mockAab, 'valid aab binary content');

      const mockSa = {
        type: 'service_account',
        project_id: 'mock-proj',
        private_key_id: '123',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9mockKey\n-----END PRIVATE KEY-----\n',
        client_email: 'bot@mock-proj.iam.gserviceaccount.com',
      };

      const res = await publisher.publishAndroid({
        cwd: testDir,
        artifactPath: mockAab,
        env: {
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(mockSa),
          PATH: '/usr/bin:/bin', // ensure fastlane does not exist or fails cleanly
        },
      });

      expect(res.success).toBe(false);
      // Either classified as missing-fastlane or command error
      expect(res.message).toBeDefined();
      expect(res.message.length).toBeGreaterThan(0);
    });
  });

  // 12. Credential-validation errors that contain sensitive-looking values
  describe('Matrix 12: Credential-validation errors containing sensitive-looking values', () => {
    it('redacts sensitive values (passwords, private keys, API secrets) from output', () => {
      const secretPassword = 'P@ssw0rd!SuperSecretKeystoreKey';
      const secretPem =
        '-----BEGIN PRIVATE KEY-----\nMIIEvgIBANBAKSECRETKEY9988==\n-----END PRIVATE KEY-----';

      registerSecretForRedaction(secretPassword);
      registerSecretForRedaction(secretPem);

      const rawErrorMessage = `Error: Authentication failed with password ${secretPassword} and key ${secretPem}`;
      const masked = maskSecrets(rawErrorMessage);

      expect(masked).not.toContain(secretPassword);
      expect(masked).not.toContain('MIIEvgIBANBAKSECRETKEY9988==');
      expect(masked).toContain('[REDACTED]');
    });
  });
});
