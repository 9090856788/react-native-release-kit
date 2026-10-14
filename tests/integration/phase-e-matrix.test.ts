import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/commands/init.js';
import { doctorCommand } from '../../src/commands/doctor.js';
import { setupCommand } from '../../src/commands/setup.js';
import { buildCommand } from '../../src/commands/build.js';
import { deployCommand } from '../../src/commands/deploy.js';
import { runDoctorChecks } from '../../src/validators/prerequisites.js';
import { loadConfig } from '../../src/config/loader.js';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';
import { clearRegisteredSecrets } from '../../src/utils/logger.js';

const MOCK_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'mock-matrix-play',
  private_key_id: 'key-123456',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9matrixKey\n-----END PRIVATE KEY-----\n',
  client_email: 'matrix-bot@mock-matrix-play.iam.gserviceaccount.com',
  client_id: '1234567890123456',
};

const MOCK_ENV = {
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(MOCK_SERVICE_ACCOUNT),
};

describe('Phase E — Multi-Project Matrix Validation', { timeout: 30000 }, () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    clearRegisteredSecrets();
    tempBaseDir = path.join(
      tmpdir(),
      `rn-release-phase-e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(tempBaseDir, { recursive: true });
  });

  afterEach(async () => {
    clearRegisteredSecrets();
    await fs.rm(tempBaseDir, { recursive: true, force: true });
  });

  async function createMockSdkAndGradlew(androidDir: string, appModule = 'app'): Promise<void> {
    const mockSdkDir = path.join(tempBaseDir, 'mock-sdk');
    await fs.mkdir(mockSdkDir, { recursive: true });
    await fs.writeFile(
      path.join(androidDir, 'local.properties'),
      `sdk.dir=${mockSdkDir.replace(/\\/g, '/')}\n`,
    );

    const gradlewPath = path.join(androidDir, 'gradlew');
    await fs.writeFile(
      gradlewPath,
      `#!/bin/sh
TASK="$1"
echo "Executing mock Gradle task: $TASK"
case "$TASK" in
  *assembleDebug*)
    mkdir -p ${appModule}/build/outputs/apk/debug
    echo "MOCK_APK" > ${appModule}/build/outputs/apk/debug/app-debug.apk
    ;;
  *bundleDebug*)
    mkdir -p ${appModule}/build/outputs/bundle/debug
    echo "MOCK_AAB" > ${appModule}/build/outputs/bundle/debug/app-debug.aab
    ;;
  *bundleRelease*|*bundle*Release*)
    mkdir -p ${appModule}/build/outputs/bundle/release
    echo "MOCK_AAB" > ${appModule}/build/outputs/bundle/release/app-release.aab
    ;;
  *)
    mkdir -p ${appModule}/build/outputs/bundle/release
    echo "MOCK_GENERIC" > ${appModule}/build/outputs/bundle/release/app-release.aab
    ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
  }

  // =========================================================================
  // Fixture 1: Standard RN CLI (npm, Groovy Gradle :app, Workspace + Scheme App)
  // =========================================================================
  describe('Fixture 1: Standard RN CLI (npm, Groovy Gradle :app, Xcode Workspace + Scheme App)', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = path.join(tempBaseDir, 'fixture-1-standard');
      await fs.mkdir(fixtureDir, { recursive: true });

      // Package configuration
      await fs.writeFile(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify(
          {
            name: 'standard-rn-app',
            dependencies: { 'react-native': '0.76.0' },
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
      await fs.writeFile(path.join(fixtureDir, 'package-lock.json'), '{}');

      // Android configuration (:app with Groovy Gradle and safe release signingConfig)
      const androidDir = path.join(fixtureDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'settings.gradle'),
        `rootProject.name = 'StandardRNApp'\ninclude ':app'\n`,
      );
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
apply plugin: 'com.android.application'
android {
    namespace "com.standard.rnapp"
    defaultConfig {
        applicationId "com.standard.rnapp"
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`,
      );
      await createMockSdkAndGradlew(androidDir, 'app');

      // iOS configuration (Workspace + shared scheme App)
      const iosDir = path.join(fixtureDir, 'ios');
      const wsDir = path.join(iosDir, 'App.xcworkspace');
      const projDir = path.join(iosDir, 'App.xcodeproj', 'xcshareddata', 'xcschemes');
      await fs.mkdir(wsDir, { recursive: true });
      await fs.mkdir(projDir, { recursive: true });
      await fs.writeFile(
        path.join(wsDir, 'contents.xcworkspacedata'),
        '<Workspace version="1.0" />',
      );
      await fs.writeFile(
        path.join(projDir, 'App.xcscheme'),
        '<Scheme LastUpgradeVersion="1500" />',
      );
      await fs.writeFile(path.join(iosDir, 'Podfile'), "target 'App' do\nend\n");
    });

    it('runs end-to-end matrix lifecycle: init -> doctor -> setup -> build -> deploy', async () => {
      // 1. init
      const initExit = await initCommand({ cwd: fixtureDir, yes: true });
      expect(initExit).toBe(0);

      const loaded = await loadConfig(fixtureDir);
      expect(loaded.config).toBeDefined();
      const config = loaded.config!;
      expect(config.packageManager).toBe('npm');
      expect(config.android.enabled).toBe(true);
      expect(config.android.appModule).toBe('app');
      expect(config.android.applicationId).toBe('com.standard.rnapp');
      expect(config.ios.enabled).toBe(true);
      expect(config.ios.scheme).toBe('App');
      expect(config.scripts.lint).toBe('npm run lint');
      expect(config.scripts.typecheck).toBe('npm run typecheck');
      expect(config.scripts.test).toBe('npm test');

      // 2. doctor (--json)
      const report = await runDoctorChecks({ cwd: fixtureDir });
      expect(report.checks.length).toBeGreaterThan(0);
      expect(typeof report.passed).toBe('boolean');
      const doctorExit = await doctorCommand({ cwd: fixtureDir, json: true });
      expect(doctorExit).toBe(report.passed ? 0 : 1);

      // 3. setup --provider github-actions --fastlane
      const setupExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
      });
      expect(setupExit).toBe(0);

      const workflowsDir = path.join(fixtureDir, '.github', 'workflows');
      const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
      const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
      const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

      expect(validateWorkflowYaml(prYaml).valid).toBe(true);
      expect(validateWorkflowYaml(mainYaml).valid).toBe(true);
      expect(validateWorkflowYaml(releaseYaml).valid).toBe(true);

      // Verify PR validation uses npm ci and runs all 3 detected scripts
      expect(prYaml).toContain('run: npm ci');
      expect(prYaml).toContain('run: npm run lint');
      expect(prYaml).toContain('run: npm run typecheck');
      expect(prYaml).toContain('run: npm test');

      // Verify Main build compiles Android bundleDebug and iOS App scheme
      expect(mainYaml).toContain('./gradlew bundleDebug');
      expect(mainYaml).toContain('-workspace "ios/App.xcworkspace"');
      expect(mainYaml).toContain('-scheme "App"');

      // Verify Release tag compiles bundleRelease and archives iOS App scheme
      expect(releaseYaml).toContain('./gradlew bundleRelease');
      expect(releaseYaml).toContain('-scheme "App"');

      // Verify Fastlane files
      const appfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Appfile'), 'utf-8');
      const fastfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Fastfile'), 'utf-8');
      expect(appfile).toContain('com.standard.rnapp');
      expect(fastfile).toContain('lane :deploy_internal');
      expect(fastfile).toContain('lane :deploy_testflight');
      expect(fastfile).toContain('scheme: ENV["IOS_SCHEME"] || "App"');

      // Verify Non-destructive overwrite rejection
      const mainFile = path.join(workflowsDir, 'main-build.yml');
      await fs.writeFile(mainFile, '# modified by user\nname: Custom\n');
      const rejectedExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
        force: false,
      });
      expect(rejectedExit).toBe(1);

      const forceExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
        force: true,
      });
      expect(forceExit).toBe(0);

      // 4. build (dry-run)
      const buildAndroidExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'android',
        dryRun: true,
        skipEnvCheck: true,
      });
      expect(buildAndroidExit).toBe(0);

      // 5. deploy (dry-run across tracks & safeguards)
      const artifactDir = path.join(
        fixtureDir,
        'android',
        'app',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(artifactDir, { recursive: true });
      const aabPath = path.join(artifactDir, 'app-release.aab');
      await fs.writeFile(aabPath, 'MOCK_BINARY_DATA');

      const internalDeployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'internal',
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(internalDeployExit).toBe(0);

      // Production safeguard blocks without confirm
      const blockedDeployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'production',
        confirmProduction: false,
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(blockedDeployExit).toBe(1);

      // Production safeguard permits with confirm
      const allowedDeployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'production',
        confirmProduction: true,
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(allowedDeployExit).toBe(0);
    });
  });

  // =========================================================================
  // Fixture 2: Kotlin DSL & pnpm (build.gradle.kts :mobile, .xcodeproj without workspace, no typecheck)
  // =========================================================================
  describe('Fixture 2: Kotlin DSL & pnpm (build.gradle.kts :mobile, .xcodeproj without workspace, no typecheck)', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = path.join(tempBaseDir, 'fixture-2-kotlindsl');
      await fs.mkdir(fixtureDir, { recursive: true });

      // Package configuration (pnpm, no typecheck script)
      await fs.writeFile(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify(
          {
            name: 'kotlin-dsl-app',
            dependencies: { 'react-native': '0.76.0' },
            scripts: {
              lint: 'eslint .',
              test: 'jest',
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(fixtureDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');

      // Android configuration (Kotlin DSL, custom module :mobile, property-based signing)
      const androidDir = path.join(fixtureDir, 'android');
      const mobileDir = path.join(androidDir, 'mobile');
      await fs.mkdir(mobileDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'settings.gradle.kts'),
        `rootProject.name = "KotlinDslApp"\ninclude(":mobile")\n`,
      );
      await fs.writeFile(
        path.join(mobileDir, 'build.gradle.kts'),
        `
plugins {
    id("com.android.application")
}
android {
    namespace = "com.kotlindsl.mobile"
    defaultConfig {
        applicationId = "com.kotlindsl.mobile"
        versionCode = 1
        versionName = "1.0.0"
    }
    signingConfigs {
        create("release") {
            storeFile = file(project.findProperty("MYAPP_RELEASE_STORE_FILE") ?: "release.keystore")
            storePassword = project.findProperty("MYAPP_RELEASE_STORE_PASSWORD") as String? ?: ""
            keyAlias = project.findProperty("MYAPP_RELEASE_KEY_ALIAS") as String? ?: ""
            keyPassword = project.findProperty("MYAPP_RELEASE_KEY_PASSWORD") as String? ?: ""
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
`,
      );
      await createMockSdkAndGradlew(androidDir, 'mobile');

      // iOS configuration (.xcodeproj without workspace, custom scheme ClientApp)
      const iosDir = path.join(fixtureDir, 'ios');
      const projDir = path.join(iosDir, 'ClientApp.xcodeproj', 'xcshareddata', 'xcschemes');
      await fs.mkdir(projDir, { recursive: true });
      await fs.writeFile(
        path.join(projDir, 'ClientApp.xcscheme'),
        '<Scheme LastUpgradeVersion="1500" />',
      );
    });

    it('runs end-to-end matrix lifecycle: pnpm lockfile, custom :mobile module, and .xcodeproj resolution', async () => {
      // 1. init
      const initExit = await initCommand({ cwd: fixtureDir, yes: true });
      expect(initExit).toBe(0);

      const loaded = await loadConfig(fixtureDir);
      const config = loaded.config!;
      expect(config.packageManager).toBe('pnpm');
      expect(config.android.appModule).toBe('mobile');
      expect(config.android.applicationId).toBe('com.kotlindsl.mobile');
      expect(config.ios.scheme).toBe('ClientApp');
      expect(config.scripts.typecheck).toBeUndefined();

      // 2. doctor
      const report = await runDoctorChecks({ cwd: fixtureDir });
      expect(report.checks.length).toBeGreaterThan(0);
      const doctorExit = await doctorCommand({ cwd: fixtureDir, json: true });
      expect(doctorExit).toBe(report.passed ? 0 : 1);

      // 3. setup
      const setupExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
      });
      expect(setupExit).toBe(0);

      const workflowsDir = path.join(fixtureDir, '.github', 'workflows');
      const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
      const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
      const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

      // Verify pnpm frozen install and absence of typecheck script
      expect(prYaml).toContain('run: pnpm install --frozen-lockfile');
      expect(prYaml).toContain('run: pnpm lint');
      expect(prYaml).toContain('run: pnpm test');
      expect(prYaml).not.toContain('pnpm typecheck');
      expect(prYaml).not.toContain('pnpm run typecheck');

      // Verify Android uses module :mobile and iOS uses -project "ios/ClientApp.xcodeproj" without pod install
      expect(mainYaml).toContain('./gradlew :mobile:bundleDebug');
      expect(mainYaml).toContain('-project "ios/ClientApp.xcodeproj"');
      expect(mainYaml).toContain('-scheme "ClientApp"');
      expect(mainYaml).not.toContain('pod install');

      // Verify release-tag workflow uses formatted module task
      expect(releaseYaml).toContain('./gradlew :mobile:bundleRelease');
      expect(releaseYaml).toContain('-project "ios/ClientApp.xcodeproj"');
      expect(releaseYaml).toContain('-scheme "ClientApp"');

      // Fastlane file verification
      const fastfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Fastfile'), 'utf-8');
      expect(fastfile).toContain('scheme: ENV["IOS_SCHEME"] || "ClientApp"');

      // 4. build (dry-run)
      const buildAndroidExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'android',
        dryRun: true,
        skipEnvCheck: true,
      });
      expect(buildAndroidExit).toBe(0);

      // 5. deploy (dry-run)
      const artifactDir = path.join(
        fixtureDir,
        'android',
        'mobile',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, 'app-release.aab'), 'MOCK_BINARY_DATA');

      const deployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'internal',
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(deployExit).toBe(0);
    });
  });

  // =========================================================================
  // Fixture 3: Android-only & Bun (bun.lockb, Groovy Gradle :app, zero iOS folder)
  // =========================================================================
  describe('Fixture 3: Android-only & Bun (bun.lockb, Groovy Gradle :app, zero iOS folder)', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = path.join(tempBaseDir, 'fixture-3-bun-android');
      await fs.mkdir(fixtureDir, { recursive: true });

      // Package configuration (Bun)
      await fs.writeFile(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify(
          {
            name: 'bun-android-app',
            dependencies: { 'react-native': '0.76.0' },
            scripts: {
              lint: 'eslint .',
              test: 'bun test',
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(fixtureDir, 'bun.lockb'), 'MOCK_BUN_LOCK');

      // Android configuration (:app)
      const androidDir = path.join(fixtureDir, 'android');
      const appDir = path.join(androidDir, 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'settings.gradle'),
        `rootProject.name = 'BunAndroidApp'\ninclude ':app'\n`,
      );
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
apply plugin: 'com.android.application'
android {
    namespace "com.bun.androidapp"
    defaultConfig {
        applicationId "com.bun.androidapp"
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        release {
            storeFile file("release.keystore")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`,
      );
      await createMockSdkAndGradlew(androidDir, 'app');
      // Zero iOS directory created
    });

    it('runs end-to-end matrix lifecycle: Bun lockfile, Android-only jobs, and zero iOS suppression', async () => {
      // 1. init
      const initExit = await initCommand({ cwd: fixtureDir, yes: true });
      expect(initExit).toBe(0);

      const loaded = await loadConfig(fixtureDir);
      const config = loaded.config!;
      expect(config.packageManager).toBe('bun');
      expect(config.android.enabled).toBe(true);
      expect(config.ios.enabled).toBe(false);

      // 2. doctor
      const report = await runDoctorChecks({ cwd: fixtureDir });
      expect(report.checks.length).toBeGreaterThan(0);

      // 3. setup
      const setupExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
      });
      expect(setupExit).toBe(0);

      const workflowsDir = path.join(fixtureDir, '.github', 'workflows');
      const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
      const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
      const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

      // Verify Bun frozen install
      expect(prYaml).toContain('run: bun install --frozen-lockfile');
      expect(prYaml).toContain('run: bun lint');
      expect(prYaml).toContain('run: bun test');

      // Verify Android jobs present, iOS jobs completely omitted
      expect(mainYaml).toContain('build-android:');
      expect(mainYaml).not.toContain('build-ios:');

      expect(releaseYaml).toContain('release-android:');
      expect(releaseYaml).not.toContain('release-ios:');

      // Fastlane should be Android-only
      const fastfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Fastfile'), 'utf-8');
      expect(fastfile).toContain('platform :android');
      expect(fastfile).not.toContain('platform :ios');

      // 4. build (dry-run)
      const buildAndroidExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'android',
        dryRun: true,
        skipEnvCheck: true,
      });
      expect(buildAndroidExit).toBe(0);

      // iOS build fails gracefully since iOS is not enabled
      const buildIOSExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'ios',
        dryRun: true,
      });
      expect(buildIOSExit).toBe(1);

      // 5. deploy (dry-run)
      const artifactDir = path.join(
        fixtureDir,
        'android',
        'app',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, 'app-release.aab'), 'MOCK_BINARY_DATA');

      const deployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'internal',
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(deployExit).toBe(0);
    });
  });

  // =========================================================================
  // Fixture 4: iOS-only & Yarn Berry (yarn.lock, .yarnrc.yml, CocoaPods, zero Android folder)
  // =========================================================================
  describe('Fixture 4: iOS-only & Yarn Berry (yarn.lock, .yarnrc.yml, CocoaPods, zero Android folder)', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = path.join(tempBaseDir, 'fixture-4-yarn-berry-ios');
      await fs.mkdir(fixtureDir, { recursive: true });

      // Package configuration (Yarn Berry with .yarnrc.yml)
      await fs.writeFile(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify(
          {
            name: 'yarn-berry-ios-app',
            dependencies: { 'react-native': '0.76.0' },
            scripts: {
              lint: 'eslint .',
              test: 'jest',
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(fixtureDir, 'yarn.lock'), '# yarn lockfile v1\n');
      await fs.writeFile(path.join(fixtureDir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');

      // iOS configuration (CocoaPods, custom bundle ID com.iosonly.app)
      const iosDir = path.join(fixtureDir, 'ios');
      const wsDir = path.join(iosDir, 'IOSOnlyApp.xcworkspace');
      const projDir = path.join(iosDir, 'IOSOnlyApp.xcodeproj');
      const schemesDir = path.join(projDir, 'xcshareddata', 'xcschemes');
      await fs.mkdir(wsDir, { recursive: true });
      await fs.mkdir(schemesDir, { recursive: true });

      await fs.writeFile(
        path.join(wsDir, 'contents.xcworkspacedata'),
        '<Workspace version="1.0" />',
      );
      await fs.writeFile(
        path.join(schemesDir, 'IOSOnlyApp.xcscheme'),
        '<Scheme LastUpgradeVersion="1500" />',
      );
      await fs.writeFile(path.join(iosDir, 'Podfile'), "target 'IOSOnlyApp' do\nend\n");
      await fs.writeFile(
        path.join(projDir, 'project.pbxproj'),
        `
// !$*UTF8*$!
{
    objects = {
        1 = {
            buildSettings = {
                PRODUCT_NAME = "IOSOnlyApp";
                PRODUCT_BUNDLE_IDENTIFIER = "com.iosonly.app";
            };
        };
    };
}
`,
      );
      // Zero android directory created
    });

    it('runs end-to-end matrix lifecycle: Yarn Berry immutable install, iOS-only jobs, and zero Android suppression', async () => {
      // 1. init
      const initExit = await initCommand({ cwd: fixtureDir, yes: true });
      expect(initExit).toBe(0);

      const loaded = await loadConfig(fixtureDir);
      const config = loaded.config!;
      expect(config.packageManager).toBe('yarn');
      expect(config.android.enabled).toBe(false);
      expect(config.ios.enabled).toBe(true);
      expect(config.ios.bundleId).toBe('com.iosonly.app');
      expect(config.ios.scheme).toBe('IOSOnlyApp');

      // 2. doctor
      const report = await runDoctorChecks({ cwd: fixtureDir });
      expect(report.checks.length).toBeGreaterThan(0);

      // 3. setup
      const setupExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
      });
      expect(setupExit).toBe(0);

      const workflowsDir = path.join(fixtureDir, '.github', 'workflows');
      const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
      const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
      const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

      // Verify Yarn Berry immutable command
      expect(prYaml).toContain('run: yarn install --immutable');

      // Verify iOS build present, Android build omitted
      expect(mainYaml).toContain('build-ios:');
      expect(mainYaml).not.toContain('build-android:');
      expect(mainYaml).toContain('-workspace "ios/IOSOnlyApp.xcworkspace"');
      expect(mainYaml).toContain('-scheme "IOSOnlyApp"');

      // Verify release-tag workflow has release-ios only
      expect(releaseYaml).toContain('release-ios:');
      expect(releaseYaml).not.toContain('release-android:');

      // Fastlane should be iOS-only with correct bundle identifier
      const appfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Appfile'), 'utf-8');
      const fastfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Fastfile'), 'utf-8');
      expect(appfile).toContain('"com.iosonly.app"');
      expect(fastfile).toContain('platform :ios');
      expect(fastfile).not.toContain('platform :android');

      // 4. build (dry-run): Android fails gracefully since android folder is missing
      const buildAndroidExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'android',
        dryRun: true,
        skipEnvCheck: true,
      });
      expect(buildAndroidExit).toBe(1);

      // 5. deploy: CLI rejects local iOS publishing with actionable guidance
      const deployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'ios',
        dryRun: true,
      });
      expect(deployExit).toBe(1);
    });
  });

  // =========================================================================
  // Fixture 5: Custom module, flavors, and scripts (Yarn classic, :clientApp, staging/production, npx tsc)
  // =========================================================================
  describe('Fixture 5: Custom module, flavors, and scripts (Yarn classic, :clientApp, staging/production, standalone typecheck)', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = path.join(tempBaseDir, 'fixture-5-custom-flavor');
      await fs.mkdir(fixtureDir, { recursive: true });

      // Package configuration (Yarn classic, no typecheck script, no test script)
      await fs.writeFile(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify(
          {
            name: 'custom-flavor-app',
            dependencies: { 'react-native': '0.76.0' },
            scripts: {
              lint: 'eslint .',
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(fixtureDir, 'yarn.lock'), '# yarn lockfile v1\n');

      // Android configuration (custom module :clientApp with flavors staging and production)
      const androidDir = path.join(fixtureDir, 'android');
      const clientAppDir = path.join(androidDir, 'clientApp');
      await fs.mkdir(clientAppDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'settings.gradle'),
        `rootProject.name = 'CustomFlavorApp'\ninclude ':clientApp'\n`,
      );
      await fs.writeFile(
        path.join(clientAppDir, 'build.gradle'),
        `
apply plugin: 'com.android.application'
android {
    namespace "com.custom.clientapp"
    defaultConfig {
        applicationId "com.custom.clientapp"
        versionCode 1
        versionName "1.0.0"
    }
    flavorDimensions "environment"
    productFlavors {
        staging {
            dimension "environment"
            applicationIdSuffix ".staging"
        }
        production {
            dimension "environment"
        }
    }
    signingConfigs {
        release {
            storeFile file("release.keystore")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`,
      );
      await createMockSdkAndGradlew(androidDir, 'clientApp');

      // iOS configuration (Workspace + shared scheme FlavoredApp)
      const iosDir = path.join(fixtureDir, 'ios');
      const wsDir = path.join(iosDir, 'FlavoredApp.xcworkspace');
      const projDir = path.join(iosDir, 'FlavoredApp.xcodeproj', 'xcshareddata', 'xcschemes');
      await fs.mkdir(wsDir, { recursive: true });
      await fs.mkdir(projDir, { recursive: true });
      await fs.writeFile(
        path.join(wsDir, 'contents.xcworkspacedata'),
        '<Workspace version="1.0" />',
      );
      await fs.writeFile(
        path.join(projDir, 'FlavoredApp.xcscheme'),
        '<Scheme LastUpgradeVersion="1500" />',
      );
      await fs.writeFile(path.join(iosDir, 'Podfile'), "target 'FlavoredApp' do\nend\n");
    });

    it('runs end-to-end matrix lifecycle: custom module :clientApp, standalone typecheck preservation, and flavor resolution', async () => {
      // 1. init
      const initExit = await initCommand({ cwd: fixtureDir, yes: true });
      expect(initExit).toBe(0);

      const loaded = await loadConfig(fixtureDir);
      const config = loaded.config!;
      expect(config.packageManager).toBe('yarn');
      expect(config.android.appModule).toBe('clientApp');
      expect(config.android.applicationId).toBe('com.custom.clientapp');
      expect(config.scripts.lint).toBe('yarn lint');
      expect(config.scripts.typecheck).toBeUndefined();
      expect(config.scripts.test).toBeUndefined();

      // Configure custom standalone typecheck command explicitly in config file
      const configFile = path.join(fixtureDir, 'react-native-release.config.ts');
      const updatedConfigContent = `import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'custom-flavor-app',
  packageManager: 'yarn',
  scripts: {
    lint: 'yarn lint',
    typecheck: 'npx tsc --noEmit',
  },
  android: {
    enabled: true,
    appModule: 'clientApp',
    flavor: 'production',
    buildArtifact: 'aab',
    buildTask: 'bundleRelease',
    deploymentTrack: 'internal',
    applicationId: 'com.custom.clientapp',
    packagePath: 'android',
  },
  ios: {
    enabled: true,
    scheme: 'FlavoredApp',
    exportMethod: 'app-store',
    packagePath: 'ios',
  },
});
`;
      await fs.writeFile(configFile, updatedConfigContent);

      // 2. doctor
      const report = await runDoctorChecks({ cwd: fixtureDir });
      expect(report.checks.length).toBeGreaterThan(0);

      // 3. setup
      const setupExit = await setupCommand({
        cwd: fixtureDir,
        provider: 'github-actions',
        fastlane: true,
      });
      expect(setupExit).toBe(0);

      const workflowsDir = path.join(fixtureDir, '.github', 'workflows');
      const prYaml = await fs.readFile(path.join(workflowsDir, 'pr-validation.yml'), 'utf-8');
      const mainYaml = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
      const releaseYaml = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

      // Verify PR validation uses yarn install --frozen-lockfile, runs npx tsc --noEmit, and omits test
      expect(prYaml).toContain('run: yarn install --frozen-lockfile');
      expect(prYaml).toContain('run: yarn lint');
      expect(prYaml).toContain('run: npx tsc --noEmit');
      expect(prYaml).not.toContain('Run Tests');

      // Verify Android uses module :clientApp formatting with production flavor
      expect(mainYaml).toContain('./gradlew :clientApp:bundleProductionDebug');
      expect(releaseYaml).toContain('./gradlew :clientApp:bundleProductionRelease');

      // Fastlane files
      const fastfile = await fs.readFile(path.join(fixtureDir, 'fastlane', 'Fastfile'), 'utf-8');
      expect(fastfile).toContain('platform :android');
      expect(fastfile).toContain('platform :ios');
      expect(fastfile).toContain('scheme: ENV["IOS_SCHEME"] || "FlavoredApp"');

      // 4. build (dry-run with custom appModule and flavor)
      const buildAndroidExit = await buildCommand({
        cwd: fixtureDir,
        platform: 'android',
        dryRun: true,
        skipEnvCheck: true,
      });
      expect(buildAndroidExit).toBe(0);

      // 5. deploy (dry-run with custom appModule artifact location)
      const artifactDir = path.join(
        fixtureDir,
        'android',
        'clientApp',
        'build',
        'outputs',
        'bundle',
        'productionRelease',
      );
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, 'app-production-release.aab'), 'MOCK_BINARY_DATA');

      const deployExit = await deployCommand({
        cwd: fixtureDir,
        platform: 'android',
        track: 'internal',
        dryRun: true,
        env: MOCK_ENV,
      });
      expect(deployExit).toBe(0);
    });
  });
});
