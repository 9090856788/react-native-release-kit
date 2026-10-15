import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  AndroidAdapter,
  resolveGradleTask,
  formatGradleTaskForWorkflow,
  locateBuiltArtifact,
  validateAndroidSigning,
  provisionSigningKeystore,
} from '../../src/adapters/android.js';
import { detectAndroid } from '../../src/detector/android.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';
import {
  maskSecrets,
  registerSecretForRedaction,
  clearRegisteredSecrets,
} from '../../src/utils/logger.js';

function createTestConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = ReleaseKitConfigSchema.parse(createDefaultConfig('android-test-app', 'npm'));
  return {
    ...base,
    ...overrides,
    android: {
      ...base.android,
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

describe('Android Engine — Detection, Build Adapter & Release Signing', () => {
  let testDir: string;

  beforeEach(async () => {
    clearRegisteredSecrets();
    testDir = path.join(
      tmpdir(),
      `rn-release-android-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    clearRegisteredSecrets();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Android Project & Module Detection', () => {
    it('detects non-standard application module from settings.gradle and com.android.application plugin', async () => {
      const androidDir = path.join(testDir, 'android');
      const customModuleDir = path.join(androidDir, 'mobile');
      await fs.mkdir(customModuleDir, { recursive: true });

      await fs.writeFile(
        path.join(androidDir, 'settings.gradle'),
        `rootProject.name = 'CustomRN'\ninclude ':core', ':mobile'\n`,
      );
      await fs.writeFile(path.join(androidDir, 'gradlew'), '#!/bin/sh\nexit 0\n');
      await fs.writeFile(
        path.join(customModuleDir, 'build.gradle'),
        `
plugins {
    id("com.android.application")
}
android {
    namespace "com.custom.mobile"
    defaultConfig {
        applicationId "com.custom.mobile.app"
        versionCode 42
        versionName "2.3.1"
    }
    productFlavors {
        staging {
            dimension "env"
        }
        production {
            dimension "env"
        }
    }
}
`,
      );

      const detected = await detectAndroid(testDir);
      expect(detected.hasAndroid).toBe(true);
      expect(detected.hasGradlew).toBe(true);
      expect(detected.buildGradleFound).toBe(true);
      expect(detected.appModule).toBe('mobile');
      expect(detected.detectedModules).toContain('mobile');
      expect(detected.namespace).toBe('com.custom.mobile');
      expect(detected.applicationId).toBe('com.custom.mobile.app');
      expect(detected.versionCode).toBe(42);
      expect(detected.versionName).toBe('2.3.1');
      expect(detected.flavors).toEqual(['staging', 'production']);
    });
  });

  describe('resolveGradleTask', () => {
    it('resolves debug and release tasks for APK and AAB', () => {
      expect(resolveGradleTask({ variant: 'debug', artifact: 'apk' })).toBe(':app:assembleDebug');
      expect(resolveGradleTask({ variant: 'debug', artifact: 'aab' })).toBe(':app:bundleDebug');
      expect(resolveGradleTask({ variant: 'release', artifact: 'apk' })).toBe(
        ':app:assembleRelease',
      );
      expect(resolveGradleTask({ variant: 'release', artifact: 'aab' })).toBe(':app:bundleRelease');
    });

    it('resolves tasks with custom appModule and product flavor', () => {
      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'mobile',
          flavor: 'staging',
        }),
      ).toBe(':mobile:bundleStagingRelease');

      expect(
        resolveGradleTask({
          variant: 'debug',
          artifact: 'apk',
          appModule: 'client',
          flavor: 'free',
        }),
      ).toBe(':client:assembleFreeDebug');
    });

    it('respects explicit customTask override', () => {
      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'app',
          customTask: 'bundleCustomRelease',
        }),
      ).toBe(':app:bundleCustomRelease');

      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          customTask: ':customMod:assembleSpecial',
        }),
      ).toBe(':customMod:assembleSpecial');

      // Handles custom module with various colon prefixes without duplicating colons
      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'mobile',
          customTask: 'mobile:bundleRelease',
        }),
      ).toBe(':mobile:bundleRelease');

      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'mobile',
          customTask: ':mobile:bundleRelease',
        }),
      ).toBe(':mobile:bundleRelease');

      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'clientApp',
          customTask: 'clientApp:bundleRelease',
        }),
      ).toBe(':clientApp:bundleRelease');

      expect(
        resolveGradleTask({
          variant: 'release',
          artifact: 'aab',
          appModule: 'clientApp',
          customTask: ':clientApp:bundleRelease',
        }),
      ).toBe(':clientApp:bundleRelease');
    });
  });

  describe('formatGradleTaskForWorkflow', () => {
    it('formats default app module tasks cleanly for CLI and CI', () => {
      expect(formatGradleTaskForWorkflow('bundleRelease', 'app')).toBe('bundleRelease');
      expect(formatGradleTaskForWorkflow('bundleDebug', 'app')).toBe('bundleDebug');
      expect(formatGradleTaskForWorkflow(':app:bundleRelease', 'app')).toBe(':app:bundleRelease');
      expect(formatGradleTaskForWorkflow('app:bundleRelease', 'app')).toBe(':app:bundleRelease');
    });

    it('formats custom module tasks without duplicate or malformed colons', () => {
      // Unqualified task for custom module
      expect(formatGradleTaskForWorkflow('bundleRelease', 'mobile')).toBe(':mobile:bundleRelease');
      expect(formatGradleTaskForWorkflow('bundleRelease', 'clientApp')).toBe(
        ':clientApp:bundleRelease',
      );

      // Pre-colon-qualified task for custom module
      expect(formatGradleTaskForWorkflow(':mobile:bundleRelease', 'mobile')).toBe(
        ':mobile:bundleRelease',
      );
      expect(formatGradleTaskForWorkflow('mobile:bundleRelease', 'mobile')).toBe(
        ':mobile:bundleRelease',
      );
      expect(formatGradleTaskForWorkflow(':clientApp:bundleRelease', 'clientApp')).toBe(
        ':clientApp:bundleRelease',
      );
      expect(formatGradleTaskForWorkflow('clientApp:bundleRelease', 'clientApp')).toBe(
        ':clientApp:bundleRelease',
      );

      // Multiple leading colons are cleanly stripped
      expect(formatGradleTaskForWorkflow('::mobile:bundleRelease', 'mobile')).toBe(
        ':mobile:bundleRelease',
      );
    });
  });

  describe('locateBuiltArtifact', () => {
    it('locates a valid non-empty AAB artifact', async () => {
      const bundleDir = path.join(
        testDir,
        'android',
        'app',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(bundleDir, { recursive: true });
      const aabFile = path.join(bundleDir, 'app-release.aab');
      await fs.writeFile(aabFile, 'DUMMY_AAB_BINARY_CONTENT');

      const res = locateBuiltArtifact(path.join(testDir, 'android'), {
        appModule: 'app',
        artifact: 'aab',
        variant: 'release',
      });

      expect(res.found).toBe(true);
      expect(res.artifactPath).toBe(aabFile);
      expect(res.size).toBeGreaterThan(0);
    });

    it('locates a valid non-empty flavored APK artifact', async () => {
      const apkDir = path.join(
        testDir,
        'android',
        'app',
        'build',
        'outputs',
        'apk',
        'staging',
        'debug',
      );
      await fs.mkdir(apkDir, { recursive: true });
      const apkFile = path.join(apkDir, 'app-staging-debug.apk');
      await fs.writeFile(apkFile, 'DUMMY_APK_BINARY_CONTENT');

      const res = locateBuiltArtifact(path.join(testDir, 'android'), {
        appModule: 'app',
        artifact: 'apk',
        variant: 'debug',
        flavor: 'staging',
      });

      expect(res.found).toBe(true);
      expect(res.artifactPath).toBe(apkFile);
    });

    it('rejects an empty (0-byte) artifact file', async () => {
      const bundleDir = path.join(
        testDir,
        'android',
        'app',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(bundleDir, { recursive: true });
      const emptyAab = path.join(bundleDir, 'app-release.aab');
      await fs.writeFile(emptyAab, '');

      const res = locateBuiltArtifact(path.join(testDir, 'android'), {
        appModule: 'app',
        artifact: 'aab',
        variant: 'release',
      });

      expect(res.found).toBe(false);
      expect(res.error).toContain('empty (0 bytes)');
    });

    it('returns found=false when no artifact exists in output directories', () => {
      const res = locateBuiltArtifact(path.join(testDir, 'android'), {
        appModule: 'app',
        artifact: 'aab',
        variant: 'release',
      });

      expect(res.found).toBe(false);
      expect(res.error).toContain('Expected AAB artifact was not found');
    });
  });

  describe('Release Signing Validation & Keystore Provisioning', () => {
    it('fails validation when required signing environment variables are missing', () => {
      const config = createTestConfig();
      const res = validateAndroidSigning(config, {});

      expect(res.valid).toBe(false);
      expect(res.missingVars).toHaveLength(4);
      expect(res.errors[0]).toContain('ANDROID_KEYSTORE_BASE64');
      expect(res.errors[0]).toContain('ANDROID_KEYSTORE_PASSWORD');
    });

    it('fails validation when base64 keystore is malformed', () => {
      const config = createTestConfig();
      const res = validateAndroidSigning(config, {
        ANDROID_KEYSTORE_BASE64: 'not-valid-base64!!!',
        ANDROID_KEYSTORE_PASSWORD: 'storePassword123',
        ANDROID_KEY_ALIAS: 'upload',
        ANDROID_KEY_PASSWORD: 'keyPassword123',
      });

      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('does not contain valid base64-encoded keystore data');
    });

    it('fails validation when custom signing secret names are configured but missing, without leaking secrets', () => {
      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            keystoreSecretName: 'SEC_CUSTOM_KEYSTORE_B64',
            keystorePasswordSecretName: 'SEC_CUSTOM_KEYSTORE_PWD',
            keyAliasSecretName: 'SEC_CUSTOM_KEY_ALIAS',
            keyPasswordSecretName: 'SEC_CUSTOM_KEY_PWD',
          },
        },
      });

      const res = validateAndroidSigning(config, {});
      expect(res.valid).toBe(false);
      expect(res.missingVars).toContain('SEC_CUSTOM_KEYSTORE_B64 (or ANDROID_KEYSTORE_PATH)');
      expect(res.missingVars).toContain('SEC_CUSTOM_KEYSTORE_PWD');
      expect(res.missingVars).toContain('SEC_CUSTOM_KEY_ALIAS');
      expect(res.missingVars).toContain('SEC_CUSTOM_KEY_PWD');
      expect(res.errors[0]).toContain('SEC_CUSTOM_KEYSTORE_B64');

      // Verify that when secrets are present, they are registered for redaction and never leaked
      const sensitivePassword = 'P@ssw0rd!SuperSecret';
      const validKeystoreB64 = Buffer.from('FAKE_VALID_KEYSTORE_BYTES').toString('base64');
      const partialRes = validateAndroidSigning(config, {
        SEC_CUSTOM_KEYSTORE_B64: validKeystoreB64,
        SEC_CUSTOM_KEYSTORE_PWD: sensitivePassword,
      });
      expect(partialRes.valid).toBe(false);
      expect(partialRes.missingVars).toContain('SEC_CUSTOM_KEY_ALIAS');
      expect(partialRes.missingVars).toContain('SEC_CUSTOM_KEY_PWD');

      // Check log masking
      const message = `Validation trace with ${sensitivePassword} and keystore ${validKeystoreB64}`;
      const masked = maskSecrets(message);
      expect(masked).not.toContain(sensitivePassword);
      expect(masked).not.toContain(validKeystoreB64);
      expect(masked).toContain('[REDACTED]');
    });

    it('provisions a temporary keystore file with 0600 permissions and cleans it up', async () => {
      const config = createTestConfig();
      const fakeKeystoreBytes = Buffer.from('FAKE_JKS_KEYSTORE_BINARY_PAYLOAD_1234567890');
      const base64Keystore = fakeKeystoreBytes.toString('base64');

      const env = {
        ANDROID_KEYSTORE_BASE64: base64Keystore,
        ANDROID_KEYSTORE_PASSWORD: 'superSecretStorePassword',
        ANDROID_KEY_ALIAS: 'my-release-key',
        ANDROID_KEY_PASSWORD: 'superSecretKeyPassword',
      };

      const validation = validateAndroidSigning(config, env);
      expect(validation.valid).toBe(true);
      expect(validation.mode).toBe('base64');

      const provisioned = await provisionSigningKeystore(config, env);
      expect(provisioned.isTemporary).toBe(true);
      expect(existsSync(provisioned.keystorePath)).toBe(true);

      const writtenBytes = await fs.readFile(provisioned.keystorePath);
      expect(writtenBytes.equals(fakeKeystoreBytes)).toBe(true);

      // Verify secret redaction registered the passwords and base64 content
      const leakedLog = `Gradle error with superSecretStorePassword and ${base64Keystore}`;
      const redacted = maskSecrets(leakedLog);
      expect(redacted).not.toContain('superSecretStorePassword');
      expect(redacted).not.toContain(base64Keystore);
      expect(redacted).toContain('[REDACTED]');

      // Clean up temporary file
      await provisioned.cleanup();
      expect(existsSync(provisioned.keystorePath)).toBe(false);
    });

    it('redacts PEM private keys and JSON private_key fields', () => {
      registerSecretForRedaction('myCustomRegisteredSecret99');
      const raw = `
Error: failed with myCustomRegisteredSecret99
"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQE\\n-----END PRIVATE KEY-----\\n"
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y
-----END RSA PRIVATE KEY-----
`;
      const sanitized = maskSecrets(raw);
      expect(sanitized).not.toContain('myCustomRegisteredSecret99');
      expect(sanitized).not.toContain('MIIEvgIBADANBgkqhkiG9w0BAQE');
      expect(sanitized).not.toContain('MIIEowIBAAKCAQEA0Y');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('validates static keystorePath when the file exists on disk', async () => {
      const localKeystorePath = path.join(testDir, 'my-release.keystore');
      await fs.writeFile(localKeystorePath, 'STATIC_KEYSTORE_BINARY_CONTENT');

      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            keystorePath: localKeystorePath,
          },
        },
      });

      const env = {
        ANDROID_KEYSTORE_PASSWORD: 'storePassword123',
        ANDROID_KEY_ALIAS: 'my-alias',
        ANDROID_KEY_PASSWORD: 'keyPassword123',
      };

      const res = validateAndroidSigning(config, env);
      expect(res.valid).toBe(true);
      expect(res.mode).toBe('file');
      expect(res.keystorePath).toBe(path.resolve(localKeystorePath));

      const provisioned = await provisionSigningKeystore(config, env);
      expect(provisioned.isTemporary).toBe(false);
      expect(provisioned.keystorePath).toBe(path.resolve(localKeystorePath));
      expect(provisioned.envOverrides.ANDROID_KEYSTORE_PATH).toBe(path.resolve(localKeystorePath));
      expect(provisioned.envOverrides.ORG_GRADLE_PROJECT_MYAPP_UPLOAD_STORE_FILE).toBe(
        path.resolve(localKeystorePath),
      );
      expect(provisioned.envOverrides.ORG_GRADLE_PROJECT_ANDROID_KEYSTORE_PATH).toBe(
        path.resolve(localKeystorePath),
      );

      await provisioned.cleanup();
      expect(existsSync(localKeystorePath)).toBe(true);
    });

    it('fails validation when static keystorePath does not exist on disk', () => {
      const nonExistentPath = path.join(testDir, 'non-existent.keystore');
      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            keystorePath: nonExistentPath,
          },
        },
      });

      const res = validateAndroidSigning(config, {
        ANDROID_KEYSTORE_PASSWORD: 'storePassword123',
        ANDROID_KEY_ALIAS: 'my-alias',
        ANDROID_KEY_PASSWORD: 'keyPassword123',
      });

      expect(res.valid).toBe(false);
      expect(res.mode).toBe('file');
      expect(res.errors[0]).toContain('config.signing.android.keystorePath');
      expect(res.errors[0]).toContain('does not exist');
    });

    it('supports custom secret names and environment variables', async () => {
      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            keystoreSecretName: 'CUSTOM_KEYSTORE_BASE64',
            keystorePasswordSecretName: 'CUSTOM_STORE_PASS',
            keyAliasSecretName: 'CUSTOM_ALIAS_NAME',
            keyPasswordSecretName: 'CUSTOM_KEY_PASS',
            keystorePathEnvName: 'CUSTOM_KEYSTORE_PATH',
          },
        },
      });

      const fakeKeystore = Buffer.from('CUSTOM_KEYSTORE_PAYLOAD').toString('base64');
      const env = {
        CUSTOM_KEYSTORE_BASE64: fakeKeystore,
        CUSTOM_STORE_PASS: 'customStorePass99',
        CUSTOM_ALIAS_NAME: 'custom-alias',
        CUSTOM_KEY_PASS: 'customKeyPass99',
      };

      const res = validateAndroidSigning(config, env);
      expect(res.valid).toBe(true);
      expect(res.mode).toBe('base64');

      const provisioned = await provisionSigningKeystore(config, env);
      expect(provisioned.isTemporary).toBe(true);
      expect(provisioned.envOverrides.CUSTOM_KEYSTORE_PATH).toBe(provisioned.keystorePath);
      expect(provisioned.envOverrides.CUSTOM_STORE_PASS).toBe('customStorePass99');
      expect(provisioned.envOverrides.CUSTOM_ALIAS_NAME).toBe('custom-alias');
      expect(provisioned.envOverrides.CUSTOM_KEY_PASS).toBe('customKeyPass99');
      expect(provisioned.envOverrides.ANDROID_KEYSTORE_PATH).toBe(provisioned.keystorePath);
      expect(provisioned.envOverrides.ORG_GRADLE_PROJECT_MYAPP_UPLOAD_KEY_ALIAS).toBe(
        'custom-alias',
      );

      await provisioned.cleanup();
      expect(existsSync(provisioned.keystorePath)).toBe(false);
    });
  });

  describe('AndroidAdapter Execution & Process Handling', () => {
    async function setupFakeAndroidProject(
      options: {
        createGradlew?: boolean;
        gradlewScript?: string;
      } = {},
    ): Promise<string> {
      const androidDir = path.join(testDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `android { namespace "com.test.app"\n defaultConfig { applicationId "com.test.app" } }`,
      );

      if (options.createGradlew !== false) {
        const gradlewPath = path.join(androidDir, 'gradlew');
        const script =
          options.gradlewScript ||
          `#!/bin/sh
mkdir -p app/build/outputs/bundle/release
echo "VALID_AAB_BYTES" > app/build/outputs/bundle/release/app-release.aab
exit 0
`;
        await fs.writeFile(gradlewPath, script, { mode: 0o755 });
      }

      return androidDir;
    }

    it('fails with actionable error when android directory is missing', async () => {
      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({ cwd: testDir, skipEnvCheck: true });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Android project directory not found');
      expect(res.remediation).toContain('android.packagePath');
    });

    it('fails with actionable error when gradlew wrapper is missing', async () => {
      await setupFakeAndroidProject({ createGradlew: false });
      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({ cwd: testDir, skipEnvCheck: true });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Gradle wrapper script ("gradlew") not found');
    });

    it('executes gradlew and validates generated AAB artifact on success', async () => {
      await setupFakeAndroidProject();
      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        skipEnvCheck: true,
      });

      expect(res.success).toBe(true);
      expect(res.gradleTask).toBe(':app:bundleRelease');
      expect(res.artifactType).toBe('aab');
      expect(res.artifactPath).toBeDefined();
      expect(res.artifactPath).toContain('app-release.aab');
      expect(res.artifactSize).toBeGreaterThan(0);
    });

    it('fails if gradlew exits with 0 but produces no output artifact', async () => {
      await setupFakeAndroidProject({
        gradlewScript: `#!/bin/sh\necho "Build completed without writing files"\nexit 0\n`,
      });
      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        skipEnvCheck: true,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Expected AAB artifact was not found');
    });

    it('handles gradlew non-zero exit code and redacts any leaked secrets from stderr', async () => {
      const secretPass = 'MyUltraSecretKeystorePass999';
      await setupFakeAndroidProject({
        gradlewScript: `#!/bin/sh
echo "FAILURE: Build failed with exception using ${secretPass}" >&2
exit 1
`,
      });

      const fakeKeystore = Buffer.from('FAKE_KEYSTORE_BINARY_DATA_1234567890').toString('base64');
      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            enabled: true,
          },
        },
      });
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        skipEnvCheck: true,
        env: {
          ...process.env,
          ANDROID_KEYSTORE_BASE64: fakeKeystore,
          ANDROID_KEYSTORE_PASSWORD: secretPass,
          ANDROID_KEY_ALIAS: 'upload',
          ANDROID_KEY_PASSWORD: secretPass,
        },
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Gradle task ":app:bundleRelease" failed');
      expect(res.error).not.toContain(secretPass);
      expect(res.stderr).not.toContain(secretPass);
      expect(res.stderr).toContain('[REDACTED]');
    });

    it('automatically configures release signing when building signed release with Groovy debug signing', async () => {
      const androidDir = path.join(testDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      const gradlePath = path.join(appDir, 'build.gradle');
      await fs.writeFile(
        gradlePath,
        `
plugins {
    id("com.android.application")
}
android {
    namespace "com.unsafe.app"
    defaultConfig { applicationId "com.unsafe.app" }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`,
      );

      const keystorePath = path.join(testDir, 'release.keystore');
      await fs.writeFile(keystorePath, 'fake-keystore-content');

      await fs.writeFile(
        path.join(androidDir, 'gradlew'),
        `#!/bin/sh
mkdir -p app/build/outputs/bundle/release
echo "VALID_AAB" > app/build/outputs/bundle/release/app-release.aab
exit 0
`,
        { mode: 0o755 },
      );

      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            keystorePath,
          },
        },
      });
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        sign: true,
        skipEnvCheck: true,
        env: {
          ...process.env,
          ANDROID_KEYSTORE_PASSWORD: 'test-password',
          ANDROID_KEY_ALIAS: 'test-alias',
          ANDROID_KEY_PASSWORD: 'test-password',
        },
      });

      expect(res.success).toBe(true);
      const updatedGradle = await fs.readFile(gradlePath, 'utf8');
      expect(updatedGradle).toContain('signingConfig signingConfigs.release');
      expect(updatedGradle).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
      expect(updatedGradle).not.toContain('signingConfig signingConfigs.debug');
    });

    it('fails when building signed release if release build type uses debug signing and cannot be auto-configured (e.g. Kotlin DSL)', async () => {
      const androidDir = path.join(testDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      await fs.writeFile(
        path.join(appDir, 'build.gradle.kts'),
        `
plugins {
    id("com.android.application")
}
android {
    namespace = "com.unsafe.app"
    defaultConfig { applicationId = "com.unsafe.app" }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
`,
      );
      await fs.writeFile(path.join(androidDir, 'gradlew'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        sign: true,
        skipEnvCheck: true,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Unsafe Android release signing configuration');
      expect(res.error).toContain('signingConfig signingConfigs.debug');
      expect(res.remediation).toContain('Configure a dedicated release signingConfig');
    });

    it('allows unsigned release build even if debug signing is in release, but logs a warning', async () => {
      const androidDir = path.join(testDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
android {
    namespace "com.unsafe.app"
    defaultConfig { applicationId "com.unsafe.app" }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`,
      );
      await fs.writeFile(
        path.join(androidDir, 'gradlew'),
        `#!/bin/sh
mkdir -p app/build/outputs/bundle/release
echo "VALID_AAB" > app/build/outputs/bundle/release/app-release.aab
exit 0
`,
        { mode: 0o755 },
      );

      const config = createTestConfig();
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        sign: false,
        skipEnvCheck: true,
      });

      expect(res.success).toBe(true);
      expect(res.artifactPath).toBeDefined();
    });

    it('cleans up temporary keystore file after build fails', async () => {
      let createdKeystorePath = '';

      await setupFakeAndroidProject({
        gradlewScript: `#!/bin/sh
echo "FAIL" >&2
exit 1
`,
      });

      const fakeKeystore = Buffer.from('TEMP_KEYSTORE_FOR_CLEANUP_TEST').toString('base64');
      const config = createTestConfig({
        signing: {
          ...createTestConfig().signing,
          android: {
            ...createTestConfig().signing.android,
            enabled: true,
          },
        },
      });
      const adapter = new AndroidAdapter(config);

      const env = {
        ...process.env,
        ANDROID_KEYSTORE_BASE64: fakeKeystore,
        ANDROID_KEYSTORE_PASSWORD: 'pass',
        ANDROID_KEY_ALIAS: 'alias',
        ANDROID_KEY_PASSWORD: 'pass',
      };

      // Provision once directly to see path structure, then clean
      const tempProv = await provisionSigningKeystore(config, env);
      createdKeystorePath = tempProv.keystorePath;
      await tempProv.cleanup();

      const res = await adapter.build({
        cwd: testDir,
        variant: 'release',
        artifact: 'aab',
        skipEnvCheck: true,
        env,
      });

      expect(res.success).toBe(false);
      // If the temporary file was created during adapter.build, it should have been cleaned up in finally block
      expect(existsSync(createdKeystorePath)).toBe(false);
    });
  });
});
