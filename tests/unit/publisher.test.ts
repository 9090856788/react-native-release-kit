import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  PublisherAdapter,
  validateServiceAccountCredentials,
  provisionServiceAccountKey,
  classifyPlayStoreError,
} from '../../src/adapters/publisher.js';
import { generateFastlaneFiles } from '../../src/generators/fastlane.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';
import { maskSecrets, clearRegisteredSecrets } from '../../src/utils/logger.js';

const MOCK_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'mock-play-project',
  private_key_id: 'key-id-12345',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9secretKeyData\n-----END PRIVATE KEY-----\n',
  client_email: 'release-bot@mock-play-project.iam.gserviceaccount.com',
  client_id: '1234567890',
};

function createTestConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = ReleaseKitConfigSchema.parse(createDefaultConfig('play-publish-app', 'npm'));
  return {
    ...base,
    ...overrides,
    android: {
      ...base.android,
      applicationId: 'com.company.playapp',
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

describe('Android Publishing Engine — Fastlane & Google Play', () => {
  let testDir: string;

  beforeEach(async () => {
    clearRegisteredSecrets();
    testDir = path.join(
      tmpdir(),
      `rn-release-publish-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    clearRegisteredSecrets();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function createValidArtifact(name = 'app-release.aab'): Promise<string> {
    const outDir = path.join(testDir, 'android', 'app', 'build', 'outputs', 'bundle', 'release');
    await fs.mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, name);
    await fs.writeFile(filePath, 'MOCK_SIGNED_AAB_BINARY_CONTENT');

    const appDir = path.join(testDir, 'android', 'app');
    const gradlePath = path.join(appDir, 'build.gradle');
    if (!existsSync(gradlePath)) {
      await fs.writeFile(
        gradlePath,
        `
android {
    namespace "com.company.playapp"
    defaultConfig { applicationId "com.company.playapp" }
    signingConfigs {
        release {
            storeFile file("release.keystore")
        }
    }
}
`,
      );
    }

    return filePath;
  }

  describe('Service Account Credential Validation & Provisioning', () => {
    it('fails when neither serviceAccountSecretName nor serviceAccountPathEnvName is set', async () => {
      const config = createTestConfig();
      const res = await validateServiceAccountCredentials(config, {});

      expect(res.valid).toBe(false);
      expect(res.mode).toBe('none');
      expect(res.errors[0]).toContain('Missing Google Play service account credentials');
    });

    it('validates inline JSON service account and redacts private_key from logs', async () => {
      const config = createTestConfig();
      const jsonStr = JSON.stringify(MOCK_SERVICE_ACCOUNT);

      const res = await validateServiceAccountCredentials(config, {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: jsonStr,
      });

      expect(res.valid).toBe(true);
      expect(res.mode).toBe('inline-json');
      expect(res.clientEmail).toBe(MOCK_SERVICE_ACCOUNT.client_email);

      // Ensure private key is automatically redacted
      const masked = maskSecrets(`Upload failed with key: ${MOCK_SERVICE_ACCOUNT.private_key}`);
      expect(masked).not.toContain(
        'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9secretKeyData',
      );
    });

    it('validates base64-encoded service account JSON and cleans up provisioned file', async () => {
      const config = createTestConfig();
      const b64 = Buffer.from(JSON.stringify(MOCK_SERVICE_ACCOUNT)).toString('base64');

      const env = { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: b64 };
      const res = await validateServiceAccountCredentials(config, env);
      expect(res.valid).toBe(true);
      expect(res.mode).toBe('base64-json');

      const provisioned = await provisionServiceAccountKey(config, env);
      expect(provisioned.isTemporary).toBe(true);
      expect(existsSync(provisioned.jsonKeyPath)).toBe(true);

      await provisioned.cleanup();
      expect(existsSync(provisioned.jsonKeyPath)).toBe(false);
    });

    it('validates service account JSON file on disk', async () => {
      const config = createTestConfig();
      const keyFile = path.join(testDir, 'service-account.json');
      await fs.writeFile(keyFile, JSON.stringify(MOCK_SERVICE_ACCOUNT));

      const res = await validateServiceAccountCredentials(config, {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH: keyFile,
      });

      expect(res.valid).toBe(true);
      expect(res.mode).toBe('file');
      expect(res.clientEmail).toBe(MOCK_SERVICE_ACCOUNT.client_email);
    });

    it('rejects malformed service account JSON missing required fields', async () => {
      const config = createTestConfig();
      const badJson = JSON.stringify({ type: 'service_account', client_email: 'invalid' });

      const res = await validateServiceAccountCredentials(config, {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: badJson,
      });

      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('client_email');
    });
  });

  describe('Google Play Tracks & Production Safeguards', () => {
    it('supports internal, closed, and production tracks in dry-run mode', async () => {
      const artifactPath = await createValidArtifact();
      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);
      const env = {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
      };

      for (const track of ['internal', 'closed'] as const) {
        const res = await publisher.publish({
          platform: 'android',
          track,
          artifactPath,
          dryRun: true,
          cwd: testDir,
          env,
        });
        expect(res.success).toBe(true);
        expect(res.track).toBe(track);
      }
    });

    it('rejects unsupported Google Play track names', async () => {
      const artifactPath = await createValidArtifact();
      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'invalid-track-name',
        artifactPath,
        cwd: testDir,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Unsupported Google Play track');
    });

    it('blocks production track publishing unless explicitly confirmed', async () => {
      const artifactPath = await createValidArtifact();
      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);
      const env = {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
      };

      // Blocked without confirmProduction or allowProductionPublish
      const blocked = await publisher.publish({
        platform: 'android',
        track: 'production',
        artifactPath,
        dryRun: true,
        cwd: testDir,
        env,
      });

      expect(blocked.success).toBe(false);
      expect(blocked.errorCategory).toBe('production-safeguard');
      expect(blocked.remediation).toContain('--confirm-production');

      // Allowed with confirmProduction: true
      const allowed = await publisher.publish({
        platform: 'android',
        track: 'production',
        confirmProduction: true,
        artifactPath,
        dryRun: true,
        cwd: testDir,
        env,
      });

      expect(allowed.success).toBe(true);
      expect(allowed.track).toBe('production');
    });

    it('blocks production track publishing when release signing is missing from build.gradle even if confirmed', async () => {
      const artifactPath = await createValidArtifact();
      // Overwrite build.gradle without release signingConfig
      const appDir = path.join(testDir, 'android', 'app');
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
android {
    namespace "com.company.playapp"
    defaultConfig { applicationId "com.company.playapp" }
}
`,
      );

      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);
      const env = {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
      };

      const res = await publisher.publish({
        platform: 'android',
        track: 'production',
        confirmProduction: true,
        artifactPath,
        cwd: testDir,
        env,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('no release signing configuration detected');
      expect(res.remediation).toContain('Configure a dedicated release signingConfig');
    });

    it('blocks production track publishing when build.gradle is missing even if confirmed', async () => {
      const artifactPath = await createValidArtifact();
      const appDir = path.join(testDir, 'android', 'app');
      await fs.rm(path.join(appDir, 'build.gradle'), { force: true });

      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);
      const env = {
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
      };

      const res = await publisher.publish({
        platform: 'android',
        track: 'production',
        confirmProduction: true,
        artifactPath,
        cwd: testDir,
        env,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Android Gradle configuration could not be detected');
    });

    it('returns explicit failure for iOS publishing with actionable guidance', async () => {
      const config = createTestConfig({
        ios: {
          ...createTestConfig().ios,
          enabled: true,
        },
      });
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'ios',
        track: 'testflight',
        cwd: testDir,
      });

      expect(res.success).toBe(false);
      expect(res.platform).toBe('ios');
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Local iOS store deployment via CLI is not supported');
      expect(res.remediation).toContain('generate the release workflow');
    });
  });

  describe('Artifact Pre-flight Validation', () => {
    it('fails before invoking Fastlane if artifact does not exist', async () => {
      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'internal',
        artifactPath: path.join(testDir, 'missing.aab'),
        cwd: testDir,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('does not exist');
    });

    it('fails if artifact has an invalid file extension', async () => {
      const badFile = path.join(testDir, 'bundle.zip');
      await fs.writeFile(badFile, 'ZIP_DATA');
      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'internal',
        artifactPath: badFile,
        cwd: testDir,
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Invalid artifact extension');
    });
  });

  describe('Error Classification (classifyPlayStoreError)', () => {
    it('classifies version code conflicts clearly with default appModule', () => {
      const res = classifyPlayStoreError(
        'Google Api Error: apkUpgradeVersionConflict: Version code 10 has already been used.',
      );
      expect(res.category).toBe('version-conflict');
      expect(res.remediation).toContain('Increment "versionCode" in android/app/build.gradle');
    });

    it('classifies version code conflicts dynamically using custom appModule', () => {
      const resMobile = classifyPlayStoreError(
        'Google Api Error: apkUpgradeVersionConflict: Version code 10 has already been used.',
        { appModule: 'mobile' },
      );
      expect(resMobile.category).toBe('version-conflict');
      expect(resMobile.remediation).toContain(
        'Increment "versionCode" in android/mobile/build.gradle',
      );

      const resClient = classifyPlayStoreError(
        'Google Api Error: apkUpgradeVersionConflict: Version code 10 has already been used.',
        { appModule: 'clientApp' },
      );
      expect(resClient.category).toBe('version-conflict');
      expect(resClient.remediation).toContain(
        'Increment "versionCode" in android/clientApp/build.gradle',
      );
    });

    it('classifies authentication failures', () => {
      const res = classifyPlayStoreError('Signet::AuthorizationError: invalid_grant (401)');
      expect(res.category).toBe('authentication');
    });

    it('classifies permission errors', () => {
      const res = classifyPlayStoreError(
        'Google Api Error: 403 Forbidden - The caller does not have permission',
      );
      expect(res.category).toBe('permissions');
      expect(res.remediation).toContain('Users and permissions');
    });

    it('classifies first manual upload requirement', () => {
      const res = classifyPlayStoreError(
        'Google Api Error: applicationNotFound: Package not found',
      );
      expect(res.category).toBe('first-upload-required');
    });

    it('classifies invalid signing certificate errors', () => {
      const res = classifyPlayStoreError(
        'Upload failed: APK is signed with a different certificate to the upload certificate',
      );
      expect(res.category).toBe('invalid-artifact');
    });
  });

  describe('Simulated Fastlane Supply Execution', () => {
    it('executes fastlane supply with validated arguments and cleans up temporary credentials', async () => {
      const artifactPath = await createValidArtifact();
      const binDir = path.join(testDir, 'mock-bin');
      await fs.mkdir(binDir, { recursive: true });

      const fakeFastlane = path.join(binDir, 'fastlane');
      await fs.writeFile(
        fakeFastlane,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fastlane 2.225.0"
  exit 0
fi
echo "Successfully uploaded to Play Store: $@"
exit 0
`,
        { mode: 0o755 },
      );

      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'internal',
        artifactPath,
        cwd: testDir,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
        },
      });

      expect(res.success).toBe(true);
      expect(res.track).toBe('internal');
      expect(res.message).toContain('Successfully uploaded app-release.aab');
    });

    it('returns missing-fastlane error when fastlane binary is not found', async () => {
      const artifactPath = await createValidArtifact();
      const emptyBinDir = path.join(testDir, 'empty-bin');
      await fs.mkdir(emptyBinDir, { recursive: true });

      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'internal',
        artifactPath,
        cwd: testDir,
        env: {
          PATH: emptyBinDir,
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
        },
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('missing-fastlane');
      expect(res.remediation).toContain('Install Fastlane');
    });

    it('rejects publishing when Android project uses debug signing in release build type', async () => {
      const artifactPath = await createValidArtifact();
      const androidDir = path.join(testDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
android {
    namespace "com.company.playapp"
    defaultConfig { applicationId "com.company.playapp" }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`,
      );

      const config = createTestConfig();
      const publisher = new PublisherAdapter(config);

      const res = await publisher.publish({
        platform: 'android',
        track: 'internal',
        artifactPath,
        cwd: testDir,
        env: {
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
        },
      });

      expect(res.success).toBe(false);
      expect(res.errorCategory).toBe('validation');
      expect(res.message).toContain('Unsafe Android release signing detected');
      expect(res.message).toContain('signingConfigs.debug');
      expect(res.remediation).toContain('Configure a dedicated release signingConfig');
    });
  });

  describe('Fastlane Configuration Generator', () => {
    it('generates Fastfile and Appfile with internal, closed, and safeguarded production lanes', async () => {
      const config = createTestConfig();
      const files = await generateFastlaneFiles(config, { cwd: testDir });

      expect(files).toHaveLength(3);
      const gemfile = files.find((f) => f.relativePath === 'Gemfile');
      expect(gemfile).toBeDefined();
      expect(gemfile?.content).toContain("source 'https://rubygems.org'");
      expect(gemfile?.content).toContain("gem 'fastlane'");

      const appfile = files.find((f) => f.relativePath === 'fastlane/Appfile');
      const fastfile = files.find((f) => f.relativePath === 'fastlane/Fastfile');

      expect(appfile).toBeDefined();
      expect(appfile?.content).toContain('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH');
      expect(appfile?.content).toContain('com.company.playapp');

      expect(fastfile).toBeDefined();
      expect(fastfile?.content).toContain('lane :deploy_internal');
      expect(fastfile?.content).toContain('lane :deploy_closed');
      expect(fastfile?.content).toContain('lane :deploy_production');
      expect(fastfile?.content).toContain('ALLOW_PRODUCTION_RELEASE');
    });

    it('generates iOS-only Fastfile and Appfile with TestFlight lane', async () => {
      const base = createTestConfig();
      const config = createTestConfig({
        android: {
          ...base.android,
          enabled: false,
        },
        ios: {
          ...base.ios,
          enabled: true,
          bundleId: 'com.company.iosapp',
          scheme: 'iOSApp',
        },
      });
      const files = await generateFastlaneFiles(config, { cwd: testDir });

      expect(files).toHaveLength(3);
      const gemfile = files.find((f) => f.relativePath === 'Gemfile');
      expect(gemfile).toBeDefined();
      expect(gemfile?.content).toContain("source 'https://rubygems.org'");
      expect(gemfile?.content).toContain("gem 'fastlane'");

      const appfile = files.find((f) => f.relativePath === 'fastlane/Appfile');
      const fastfile = files.find((f) => f.relativePath === 'fastlane/Fastfile');

      expect(appfile?.content).toContain('app_identifier');
      expect(appfile?.content).toContain('com.company.iosapp');

      expect(fastfile?.content).toContain('platform :ios');
      expect(fastfile?.content).toContain('lane :build_release');
      expect(fastfile?.content).toContain('lane :deploy_testflight');
      expect(fastfile?.content).toContain('upload_to_testflight');
    });

    it('generates unified Fastfile and Appfile when both Android and iOS are enabled', async () => {
      const base = createTestConfig();
      const config = createTestConfig({
        android: {
          ...base.android,
          enabled: true,
        },
        ios: {
          ...base.ios,
          enabled: true,
          bundleId: 'com.company.iosapp',
        },
      });
      const files = await generateFastlaneFiles(config, { cwd: testDir });

      expect(files).toHaveLength(3);
      const gemfile = files.find((f) => f.relativePath === 'Gemfile');
      expect(gemfile).toBeDefined();
      expect(gemfile?.content).toContain("source 'https://rubygems.org'");
      expect(gemfile?.content).toContain("gem 'fastlane'");

      const appfile = files.find((f) => f.relativePath === 'fastlane/Appfile');
      const fastfile = files.find((f) => f.relativePath === 'fastlane/Fastfile');

      expect(appfile?.content).toContain('com.company.playapp');
      expect(appfile?.content).toContain('com.company.iosapp');

      expect(fastfile?.content).toContain('platform :android');
      expect(fastfile?.content).toContain('platform :ios');
      expect(fastfile?.content).toContain('lane :deploy_internal');
      expect(fastfile?.content).toContain('lane :deploy_testflight');
    });

    it('resolves iOS scheme and workspace dynamically from project detection result when config does not specify them', async () => {
      const base = createTestConfig();
      const config = createTestConfig({
        android: {
          ...base.android,
          enabled: false,
        },
        ios: {
          ...base.ios,
          enabled: true,
          bundleId: 'com.detected.iosapp',
          scheme: undefined,
          workspace: undefined,
        },
      });

      const mockProject = {
        projectName: 'DetectedProject',
        isReactNative: true,
        reactNativeVersion: '0.76.0',
        packageManager: {
          manager: 'npm' as const,
          lockfile: 'package-lock.json',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'npm install',
          frozenInstallCommand: 'npm ci',
        },
        scripts: {},
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/DetectedApp.xcworkspace',
          schemes: ['DetectedAppTests', 'DetectedAppUITests', 'DetectedApp'],
        },
      };

      const files = await generateFastlaneFiles(config, {
        cwd: testDir,
        project: mockProject,
      });

      const fastfile = files.find((f) => f.relativePath === 'fastlane/Fastfile');
      expect(fastfile).toBeDefined();
      expect(fastfile?.content).toContain(
        'workspace: ENV["IOS_WORKSPACE"] || "ios/DetectedApp.xcworkspace"',
      );
      expect(fastfile?.content).toContain('scheme: ENV["IOS_SCHEME"] || "DetectedApp"');
      expect(fastfile?.content).not.toContain('DetectedAppTests');
    });

    it('preserves explicitly configured iOS scheme even when project defines different schemes', async () => {
      const base = createTestConfig();
      const config = createTestConfig({
        android: {
          ...base.android,
          enabled: false,
        },
        ios: {
          ...base.ios,
          enabled: true,
          bundleId: 'com.custom.iosapp',
          scheme: 'CustomProductionScheme',
        },
      });

      const mockProject = {
        projectName: 'DetectedProject',
        isReactNative: true,
        reactNativeVersion: '0.76.0',
        packageManager: {
          manager: 'npm' as const,
          lockfile: 'package-lock.json',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'npm install',
          frozenInstallCommand: 'npm ci',
        },
        scripts: {},
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
        ios: {
          hasIOS: true,
          hasPodfile: true,
          workspace: 'ios/Other.xcworkspace',
          schemes: ['OtherScheme'],
        },
      };

      const files = await generateFastlaneFiles(config, {
        cwd: testDir,
        project: mockProject,
      });

      const fastfile = files.find((f) => f.relativePath === 'fastlane/Fastfile');
      expect(fastfile?.content).toContain('scheme: ENV["IOS_SCHEME"] || "CustomProductionScheme"');
    });
  });
});
