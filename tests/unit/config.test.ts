import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  defineConfig,
  ReleaseKitConfigSchema,
  createDefaultConfig,
  getDefaultScripts,
  loadConfig,
  findAllConfigFiles,
  findConfigFile,
} from '../../src/config/index.js';

describe('Config Schema & Utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-config-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('defineConfig returns the identical user config', () => {
    const raw = {
      projectName: 'TestApp',
      packageManager: 'yarn' as const,
    };
    const conf = defineConfig(raw);
    expect(conf).toEqual(raw);
  });

  it('ReleaseKitConfigSchema validates and applies defaults with corrected iOS secrets', () => {
    const parsed = ReleaseKitConfigSchema.parse({
      projectName: 'TestApp',
    });

    expect(parsed.projectName).toBe('TestApp');
    expect(parsed.packageManager).toBe('npm');
    expect(parsed.projectRoot).toBe('.');
    expect(parsed.android.enabled).toBe(true);
    expect(parsed.android.buildArtifact).toBe('aab');
    expect(parsed.android.buildTask).toBe('bundleRelease');
    expect(parsed.android.deploymentTrack).toBe('internal');
    expect(parsed.ios.enabled).toBe(true);
    expect(parsed.ios.buildArtifact).toBe('ipa');
    expect(parsed.ios.exportMethod).toBe('app-store');
    expect(parsed.githubActions.enabled).toBe(true);
    expect(parsed.githubActions.runner.android).toBe('ubuntu-latest');
    expect(parsed.githubActions.runner.ios).toBe('macos-14');
    expect(parsed.signing.android.keystoreSecretName).toBe('ANDROID_KEYSTORE_BASE64');
    expect(parsed.signing.ios.appStoreConnectKeyContentSecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    );
    expect(parsed.signing.ios.appStoreConnectKeyIdSecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_KEY_ID',
    );
    expect(parsed.signing.ios.appStoreConnectIssuerIdSecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
    );
    // Backward-compatible alias
    expect(parsed.signing.ios.appStoreConnectApiKeySecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    );
  });

  it('supports appStoreConnectApiKeySecretName as a backward-compatible input alias', () => {
    const parsed = ReleaseKitConfigSchema.parse({
      projectName: 'TestApp',
      signing: {
        ios: {
          appStoreConnectApiKeySecretName: 'CUSTOM_KEY_SECRET',
        },
      },
    });

    expect(parsed.signing.ios.appStoreConnectKeyContentSecretName).toBe('CUSTOM_KEY_SECRET');
    expect(parsed.signing.ios.appStoreConnectApiKeySecretName).toBe('CUSTOM_KEY_SECRET');
  });

  it('fails validation when projectName is empty', () => {
    expect(() => {
      ReleaseKitConfigSchema.parse({
        projectName: '',
      });
    }).toThrow();
  });

  it('fails validation with invalid packageManager', () => {
    expect(() => {
      ReleaseKitConfigSchema.parse({
        projectName: 'App',
        packageManager: 'invalid-pm' as unknown as 'npm',
      });
    }).toThrow();
  });

  it('fails validation with invalid android buildArtifact', () => {
    expect(() => {
      ReleaseKitConfigSchema.parse({
        projectName: 'App',
        android: {
          buildArtifact: 'dmg' as unknown as 'aab',
        },
      });
    }).toThrow();
  });

  it('getDefaultScripts customizes scripts based on package manager', () => {
    const npmScripts = getDefaultScripts('npm');
    expect(npmScripts.lint).toBe('npm run lint');
    expect(npmScripts.test).toBe('npm test');

    const yarnScripts = getDefaultScripts('yarn');
    expect(yarnScripts.lint).toBe('yarn lint');
    expect(yarnScripts.test).toBe('yarn test');

    const pnpmScripts = getDefaultScripts('pnpm');
    expect(pnpmScripts.lint).toBe('pnpm lint');
    expect(pnpmScripts.test).toBe('pnpm test');
  });

  it('createDefaultConfig builds complete config with corrected secret names', () => {
    const def = createDefaultConfig('SampleApp', 'yarn');
    expect(def.projectName).toBe('SampleApp');
    expect(def.packageManager).toBe('yarn');
    expect(def.android?.buildArtifact).toBe('aab');
    expect(def.ios?.scheme).toBe('SampleApp');
    expect(def.signing?.ios?.appStoreConnectKeyContentSecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    );
  });

  describe('Configuration Precedence & Multi-File Conflicts', () => {
    it('resolves .ts over .json deterministically in precedence order', async () => {
      const tsPath = path.join(testDir, 'react-native-release.config.ts');
      const jsonPath = path.join(testDir, 'react-native-release.config.json');

      await fs.writeFile(
        tsPath,
        `import { defineConfig } from 'react-native-release-kit';\nexport default defineConfig({ projectName: 'FromTS' });`,
      );
      await fs.writeFile(jsonPath, JSON.stringify({ projectName: 'FromJSON' }));

      const all = findAllConfigFiles(testDir);
      expect(all).toHaveLength(2);
      expect(path.basename(all[0]!)).toBe('react-native-release.config.ts');
      expect(path.basename(all[1]!)).toBe('react-native-release.config.json');

      const primary = findConfigFile(testDir);
      expect(primary).toBe(tsPath);

      const loaded = await loadConfig(testDir);
      expect(loaded.config).toBeDefined();
      expect(loaded.config?.projectName).toBe('FromTS');
      expect(loaded.warnings).toBeDefined();
      expect(loaded.warnings?.[0]).toContain('Multiple configuration files found');
      expect(loaded.warnings?.[0]).toContain('react-native-release.config.ts');
    });

    it('loads .json configuration when it is the sole file', async () => {
      const jsonPath = path.join(testDir, 'react-native-release.config.json');
      await fs.writeFile(jsonPath, JSON.stringify({ projectName: 'SoloJSON' }));

      const loaded = await loadConfig(testDir);
      expect(loaded.config).toBeDefined();
      expect(loaded.config?.projectName).toBe('SoloJSON');
      expect(loaded.warnings).toBeUndefined();
    });

    it('loads .ts configuration using jiti alias even in isolated directory', async () => {
      const tsPath = path.join(testDir, 'react-native-release.config.ts');
      await fs.writeFile(
        tsPath,
        `import { defineConfig } from 'react-native-release-kit';\nexport default defineConfig({ projectName: 'IsolatedTSApp' });`,
      );

      const loaded = await loadConfig(testDir);
      expect(loaded.error).toBeUndefined();
      expect(loaded.config).toBeDefined();
      expect(loaded.config?.projectName).toBe('IsolatedTSApp');
    });
  });
});
