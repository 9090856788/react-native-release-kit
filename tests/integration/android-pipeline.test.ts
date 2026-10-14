import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildCommand } from '../../src/commands/build.js';
import { deployCommand } from '../../src/commands/deploy.js';
import { setupCommand } from '../../src/commands/setup.js';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';
import { clearRegisteredSecrets } from '../../src/utils/logger.js';

const MOCK_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'rn-release-fixture',
  private_key_id: 'fixture-key-1',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9fixtureKey\n-----END PRIVATE KEY-----\n',
  client_email: 'ci-deployer@rn-release-fixture.iam.gserviceaccount.com',
  client_id: '9988776655',
};

describe('Android Build & Publishing End-to-End Integration', () => {
  let testDir: string;
  let mockBinDir: string;

  beforeEach(async () => {
    clearRegisteredSecrets();
    testDir = path.join(
      tmpdir(),
      `rn-release-android-int-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    mockBinDir = path.join(testDir, 'mock-bin');
    await fs.mkdir(mockBinDir, { recursive: true });

    // Create React Native package.json
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-rn-android-app',
          dependencies: {
            react: '18.3.1',
            'react-native': '0.76.2',
          },
          scripts: {
            lint: 'eslint .',
            typecheck: 'tsc --noEmit',
            test: 'jest',
          },
        },
        null,
        2,
      ),
    );

    // Create native Android fixture with gradlew script that creates requested outputs
    const androidDir = path.join(testDir, 'android');
    const appDir = path.join(androidDir, 'app');
    await fs.mkdir(appDir, { recursive: true });

    await fs.writeFile(
      path.join(androidDir, 'settings.gradle'),
      `rootProject.name = 'FixtureApp'\ninclude ':app'\n`,
    );

    await fs.writeFile(
      path.join(appDir, 'build.gradle'),
      `
android {
    namespace "com.fixture.rnapp"
    defaultConfig {
        applicationId "com.fixture.rnapp"
        versionCode 10
        versionName "1.2.0"
    }
    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword "password"
            keyAlias "alias"
            keyPassword "password"
        }
    }
}
`,
    );

    // Create a mock SDK directory and local.properties so SDK check passes deterministically
    const mockSdkDir = path.join(testDir, 'mock-android-sdk');
    await fs.mkdir(mockSdkDir, { recursive: true });
    await fs.writeFile(
      path.join(androidDir, 'local.properties'),
      `sdk.dir=${mockSdkDir.replace(/\\/g, '/')}\n`,
    );

    // Create a realistic gradlew stub that inspects the task argument and writes the corresponding artifact
    const gradlewPath = path.join(androidDir, 'gradlew');
    await fs.writeFile(
      gradlewPath,
      `#!/bin/sh
TASK="$1"
case "$TASK" in
  *assembleDebug*)
    mkdir -p app/build/outputs/apk/debug
    echo "MOCK_DEBUG_APK_BINARY" > app/build/outputs/apk/debug/app-debug.apk
    ;;
  *bundleDebug*)
    mkdir -p app/build/outputs/bundle/debug
    echo "MOCK_DEBUG_AAB_BINARY" > app/build/outputs/bundle/debug/app-debug.aab
    ;;
  *assembleRelease*)
    mkdir -p app/build/outputs/apk/release
    echo "MOCK_RELEASE_APK_BINARY" > app/build/outputs/apk/release/app-release.apk
    ;;
  *bundleRelease*)
    mkdir -p app/build/outputs/bundle/release
    echo "MOCK_RELEASE_AAB_BINARY" > app/build/outputs/bundle/release/app-release.aab
    ;;
  *)
    echo "Unknown Gradle task: $TASK" >&2
    exit 1
    ;;
esac
exit 0
`,
      { mode: 0o755 },
    );

    // Create mock java and fastlane binaries in mockBinDir
    await fs.writeFile(
      path.join(mockBinDir, 'java'),
      `#!/bin/sh\necho 'openjdk version "17.0.12"'\nexit 0\n`,
      { mode: 0o755 },
    );

    await fs.writeFile(
      path.join(mockBinDir, 'fastlane'),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fastlane 2.225.0"
  exit 0
fi
echo "Fastlane supply executed: $@"
exit 0
`,
      { mode: 0o755 },
    );

    // Write react-native-release.config.ts
    await fs.writeFile(
      path.join(testDir, 'react-native-release.config.ts'),
      `
import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'fixture-rn-android-app',
  packageManager: 'npm',
  android: {
    enabled: true,
    buildVariant: 'release',
    buildArtifact: 'aab',
    deploymentTrack: 'internal',
    releaseStatus: 'draft',
    applicationId: 'com.fixture.rnapp',
    publishStore: true,
  },
  signing: {
    android: {
      enabled: false,
      keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
      keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
      keyAliasSecretName: 'ANDROID_KEY_ALIAS',
      keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
      serviceAccountSecretName: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
    },
  },
  githubActions: {
    enabled: true,
    storePublishing: true,
  },
});
`,
    );
  });

  afterEach(async () => {
    clearRegisteredSecrets();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('builds debug APK, release APK, and release AAB through buildCommand', async () => {
    const testEnv = {
      ...process.env,
      PATH: `${mockBinDir}:${process.env.PATH}`,
    };

    // 1. Build debug (defaults to APK -> :app:assembleDebug)
    const debugCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'debug',
      env: testEnv,
    });
    expect(debugCode).toBe(0);

    // 2. Build release APK (:app:assembleRelease)
    const releaseApkCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'release',
      artifact: 'apk',
      env: testEnv,
    });
    expect(releaseApkCode).toBe(0);

    // 3. Build release AAB (:app:bundleRelease)
    const releaseAabCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'release',
      artifact: 'aab',
      env: testEnv,
    });
    expect(releaseAabCode).toBe(0);
  });

  it('validates release signing credentials when --sign is enabled', async () => {
    const testEnv = {
      ...process.env,
      PATH: `${mockBinDir}:${process.env.PATH}`,
    };

    // Fails when signing credentials are missing
    const failCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'release',
      artifact: 'aab',
      sign: true,
      env: testEnv,
    });
    expect(failCode).toBe(1);

    // Succeeds when valid signing credentials are provided
    const fakeKeystoreB64 = Buffer.from('VALID_MOCK_JKS_KEYSTORE_BYTES_123456').toString('base64');
    const passCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'release',
      artifact: 'aab',
      sign: true,
      env: {
        ...testEnv,
        ANDROID_KEYSTORE_BASE64: fakeKeystoreB64,
        ANDROID_KEYSTORE_PASSWORD: 'keystorePassword123',
        ANDROID_KEY_ALIAS: 'upload-alias',
        ANDROID_KEY_PASSWORD: 'keyPassword123',
      },
    });
    expect(passCode).toBe(0);
  });

  it('builds release AAB and deploys to internal, closed, and safeguarded production tracks', async () => {
    const testEnv = {
      ...process.env,
      PATH: `${mockBinDir}:${process.env.PATH}`,
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
    };

    // First build the release AAB
    const buildCode = await buildCommand({
      cwd: testDir,
      platform: 'android',
      variant: 'release',
      artifact: 'aab',
      env: testEnv,
    });
    expect(buildCode).toBe(0);

    // Deploy to internal track
    const internalCode = await deployCommand({
      cwd: testDir,
      platform: 'android',
      track: 'internal',
      env: testEnv,
    });
    expect(internalCode).toBe(0);

    // Deploy to closed track
    const closedCode = await deployCommand({
      cwd: testDir,
      platform: 'android',
      track: 'closed',
      env: testEnv,
    });
    expect(closedCode).toBe(0);

    // Production track is blocked without --confirm-production
    const blockedProdCode = await deployCommand({
      cwd: testDir,
      platform: 'android',
      track: 'production',
      env: testEnv,
    });
    expect(blockedProdCode).toBe(1);

    // Production track succeeds with confirmProduction: true
    const confirmedProdCode = await deployCommand({
      cwd: testDir,
      platform: 'android',
      track: 'production',
      confirmProduction: true,
      env: testEnv,
    });
    expect(confirmedProdCode).toBe(0);
  });

  it('generates valid GitHub Actions workflows with Android signing, Fastlane upload, and PR secret isolation', async () => {
    const setupCode = await setupCommand({
      cwd: testDir,
      provider: 'github-actions',
    });
    expect(setupCode).toBe(0);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
    const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
    const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

    expect(validateWorkflowYaml(prYaml).valid).toBe(true);
    expect(validateWorkflowYaml(mainYaml).valid).toBe(true);
    expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);

    // Ensure PR workflow NEVER references signing or Google Play secrets
    expect(prYaml).not.toContain(' secrets.');
    expect(prYaml).not.toContain('ANDROID_KEYSTORE');
    expect(prYaml).not.toContain('GOOGLE_PLAY');

    // Ensure release-tag workflow includes store validation, Fastlane upload, and credential cleanup
    expect(releaseYaml).toContain('Validate Store Credentials');
    expect(releaseYaml).toContain('Publish to Google Play (internal)');
    expect(releaseYaml).toContain('Cleanup Google Play Credentials');
    expect(releaseYaml).toContain('if: always()');
  });
});
