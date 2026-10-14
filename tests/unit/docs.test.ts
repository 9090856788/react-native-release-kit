import { describe, it, expect } from 'vitest';
import { ReleaseKitConfigSchema, defineConfig } from '../../src/config/index.js';
import { createProgram } from '../../src/cli/index.js';

describe('Phase G Step 5 — Documentation Validation', () => {
  describe('Configuration Examples Verification', () => {
    it('validates the complete generic configuration example from README', () => {
      const fullExample = defineConfig({
        projectName: 'MyAwesomeApp',
        packageManager: 'yarn',
        projectRoot: '.',
        scripts: {
          lint: 'yarn lint',
          typecheck: 'yarn tsc --noEmit',
          test: 'yarn test',
        },
        android: {
          enabled: true,
          buildVariant: 'release',
          buildArtifact: 'aab',
          buildTask: 'bundleRelease',
          appModule: 'app',
          flavor: 'production',
          deploymentTrack: 'internal',
          releaseStatus: 'draft',
          applicationId: 'com.example.myawesomeapp',
          packagePath: 'android',
          publishStore: false,
          allowProductionPublish: false,
        },
        ios: {
          enabled: true,
          buildArtifact: 'ipa',
          scheme: 'MyAwesomeApp',
          workspace: 'ios/MyAwesomeApp.xcworkspace',
          bundleId: 'com.example.myawesomeapp',
          teamId: 'TEAMID1234',
          exportMethod: 'app-store',
          packagePath: 'ios',
          publishStore: false,
          uploadToTestFlight: false,
        },
        githubActions: {
          enabled: true,
          mainBranch: 'main',
          releaseTagPattern: 'v*',
          artifactRetentionDays: 14,
          triggers: {
            pullRequest: true,
            main: true,
            releaseTags: true,
          },
          workflows: {
            prValidation: true,
            mainBuild: true,
            releaseTag: true,
          },
          cacheDependencies: true,
          storePublishing: false,
          runner: {
            android: 'ubuntu-latest',
            ios: 'macos-14',
          },
          nodeVersion: '20',
          javaVersion: '17',
          rubyVersion: '3.3',
        },
        signing: {
          android: {
            enabled: true,
            keystorePath: 'android/app/release.keystore',
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
            teamId: 'TEAMID1234',
            certificateSecretName: 'IOS_DISTRIBUTION_CERTIFICATE_BASE64',
            certificatePasswordSecretName: 'IOS_CERTIFICATE_PASSWORD',
            provisioningProfileSecretName: 'IOS_PROVISIONING_PROFILE_BASE64',
            exportMethod: 'app-store',
            appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
            appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
            appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
          },
        },
      });

      const parsed = ReleaseKitConfigSchema.safeParse(fullExample);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.projectName).toBe('MyAwesomeApp');
        expect(parsed.data.android.appModule).toBe('app');
        expect(parsed.data.android.flavor).toBe('production');
        expect(parsed.data.ios.bundleId).toBe('com.example.myawesomeapp');
      }
    });

    it('validates minimal generic configuration snippet from quick start', () => {
      const minimalExample = defineConfig({
        projectName: 'MobileApp',
        packageManager: 'npm',
        android: {
          applicationId: 'com.example.mobileapp',
        },
        ios: {
          bundleId: 'com.example.mobileapp',
        },
      });

      const parsed = ReleaseKitConfigSchema.safeParse(minimalExample);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.projectName).toBe('MobileApp');
        expect(parsed.data.packageManager).toBe('npm');
        expect(parsed.data.android.buildVariant).toBe('release');
        expect(parsed.data.ios.exportMethod).toBe('app-store');
      }
    });

    it('validates custom module and flavor configuration snippet', () => {
      const customModuleExample = defineConfig({
        projectName: 'CustomClientApp',
        packageManager: 'pnpm',
        android: {
          appModule: ':clientApp',
          flavor: 'staging',
          buildArtifact: 'apk',
          applicationId: 'com.example.clientapp.staging',
        },
      });

      const parsed = ReleaseKitConfigSchema.safeParse(customModuleExample);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.android.appModule).toBe(':clientApp');
        expect(parsed.data.android.flavor).toBe('staging');
      }
    });
  });

  describe('CLI Help & Command Interface Parity', () => {
    it('registers all five documented primary commands with descriptions', () => {
      const program = createProgram();
      const commandNames = program.commands.map((cmd) => cmd.name());

      expect(commandNames).toContain('init');
      expect(commandNames).toContain('doctor');
      expect(commandNames).toContain('setup');
      expect(commandNames).toContain('build');
      expect(commandNames).toContain('deploy');
    });

    it('exposes documented flags on the setup command', () => {
      const program = createProgram();
      const setupCmd = program.commands.find((c) => c.name() === 'setup');
      expect(setupCmd).toBeDefined();

      const optionNames = setupCmd?.options.map((o) => o.long || o.short) || [];
      expect(optionNames).toContain('--provider');
      expect(optionNames).toContain('--fastlane');
      expect(optionNames).toContain('--dry-run');
      expect(optionNames).toContain('--diff');
      expect(optionNames).toContain('--force');
    });

    it('exposes documented flags on the build command', () => {
      const program = createProgram();
      const buildCmd = program.commands.find((c) => c.name() === 'build');
      expect(buildCmd).toBeDefined();

      const optionNames = buildCmd?.options.map((o) => o.long || o.short) || [];
      expect(optionNames).toContain('--platform');
      expect(optionNames).toContain('--variant');
      expect(optionNames).toContain('--artifact');
      expect(optionNames).toContain('--module');
      expect(optionNames).toContain('--flavor');
      expect(optionNames).toContain('--sign');
      expect(optionNames).toContain('--dry-run');
    });

    it('exposes documented flags on the deploy command', () => {
      const program = createProgram();
      const deployCmd = program.commands.find((c) => c.name() === 'deploy');
      expect(deployCmd).toBeDefined();

      const optionNames = deployCmd?.options.map((o) => o.long || o.short) || [];
      expect(optionNames).toContain('--platform');
      expect(optionNames).toContain('--track');
      expect(optionNames).toContain('--release-status');
      expect(optionNames).toContain('--artifact-path');
      expect(optionNames).toContain('--module');
      expect(optionNames).toContain('--flavor');
      expect(optionNames).toContain('--confirm-production');
      expect(optionNames).toContain('--dry-run');
    });
  });
});
