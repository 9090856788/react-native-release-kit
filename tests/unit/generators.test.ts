import { describe, it, expect } from 'vitest';
import {
  generatePrValidationWorkflow,
  generateMainBuildWorkflow,
  generateReleaseTagWorkflow,
  generateGitHubWorkflows,
  GITHUB_ACTIONS_SHAS,
} from '../../src/generators/github-actions.js';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';
import type { ProjectDetectionResult } from '../../src/detector/types.js';

function getBaseConfig(): ReleaseKitConfig {
  return ReleaseKitConfigSchema.parse(createDefaultConfig('test-mobile-app', 'npm'));
}

function createMockProject(
  overrides: Partial<ProjectDetectionResult> = {},
): ProjectDetectionResult {
  return {
    projectName: 'test-mobile-app',
    isReactNative: true,
    reactNativeVersion: '0.76.1',
    packageManager: {
      manager: 'npm',
      lockfile: 'package-lock.json',
      ambiguous: false,
      isYarnBerry: false,
      installCommand: 'npm install',
      frozenInstallCommand: 'npm ci',
    },
    android: {
      hasAndroid: true,
      hasGradlew: true,
      buildGradleFound: true,
      applicationId: 'com.test.mobileapp',
    },
    ios: {
      hasIOS: true,
      hasPodfile: true,
      workspace: 'ios/TestApp.xcworkspace',
      schemes: ['TestApp'],
    },
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'jest',
    },
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = getBaseConfig();
  return {
    ...base,
    ...overrides,
    githubActions: {
      ...base.githubActions,
      ...(overrides.githubActions || {}),
    },
    android: {
      ...base.android,
      ...(overrides.android || {}),
    },
    ios: {
      ...base.ios,
      ...(overrides.ios || {}),
    },
    scripts: {
      ...base.scripts,
      ...(overrides.scripts || {}),
    },
    signing: {
      ...base.signing,
      ...(overrides.signing || {}),
      android: {
        ...base.signing.android,
        ...(overrides.signing?.android || {}),
      },
      ios: {
        ...base.signing.ios,
        ...(overrides.signing?.ios || {}),
      },
    },
  };
}

describe('GitHub Actions Workflow Generators', () => {
  describe('PR Validation Workflow', () => {
    it('generates valid YAML with PR triggers, least-privilege permissions, and concurrency', () => {
      const config = createMockConfig();
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Verify structure and content
      expect(yaml).toContain('name: PR Validation');
      expect(yaml).toContain('pull_request:\n    branches:\n      - main');
      expect(yaml).toContain('contents: read');
      expect(yaml).toContain('pull-requests: read');
      expect(yaml).toContain('cancel-in-progress: true');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.checkout}`);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupNode}`);
      expect(yaml).toContain('run: npm ci');
      expect(yaml).toContain('run: npm run lint');
      expect(yaml).toContain('run: npm run typecheck');
      expect(yaml).toContain('run: npm test');
    });

    it('respects custom main branch configuration', () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          mainBranch: 'master',
        },
      });
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('pull_request:\n    branches:\n      - master');
    });

    it('falls back to node --version if project has no quality check scripts', () => {
      const config = createMockConfig();
      const project = createMockProject({ scripts: {} });

      const yaml = generatePrValidationWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('name: Verify Environment');
      expect(yaml).toContain('run: node --version');
      expect(yaml).not.toContain('Run Lint');
      expect(yaml).not.toContain('Run Typecheck');
      expect(yaml).not.toContain('Run Tests');
    });

    it('generates only existing scripts when partially configured', () => {
      const config = createMockConfig();
      const project = createMockProject({
        scripts: {
          lint: 'eslint .',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('name: Run Lint');
      expect(yaml).not.toContain('Run Typecheck');
      expect(yaml).not.toContain('Run Tests');
    });
  });

  describe('Main Branch Build Workflow', () => {
    it('generates valid YAML for main branch push and workflow_dispatch', () => {
      const config = createMockConfig();
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(yaml).toContain('name: Main Branch Build');
      expect(yaml).toContain('push:\n    branches:\n      - main');
      expect(yaml).toContain('workflow_dispatch:');
      expect(yaml).toContain('contents: read');
      expect(yaml).toContain('cancel-in-progress: false');
    });

    it('includes Android debug validation build job when android is enabled and detected (AAB)', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('build-android:');
      expect(yaml).toContain('name: Build Android (Debug Validation)');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupJava}`);
      expect(yaml).toContain("distribution: 'zulu'");
      expect(yaml).toContain("java-version: '17'");
      expect(yaml).toContain('run: chmod +x android/gradlew');
      expect(yaml).toContain('./gradlew bundleDebug');
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.uploadArtifact}`);
      expect(yaml).toContain('path: android/app/build/outputs/bundle/debug/*.aab');
      expect(yaml).toContain('retention-days: 14');
      expect(yaml).toContain('if-no-files-found: error');
    });

    it('builds APK when buildArtifact is apk', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'apk',
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).toContain('./gradlew assembleDebug');
      expect(yaml).toContain('path: android/app/build/outputs/apk/debug/*.apk');
      expect(yaml).toContain('name: android-${{ github.sha }}-apk');
    });

    it('omits Android build job when android.enabled is false', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
      });
      const project = createMockProject();

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-android:');
      expect(yaml).not.toContain('gradlew');
    });

    it('omits Android build job when android folder does not exist', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
      });

      const yaml = generateMainBuildWorkflow(config, project);
      expect(yaml).not.toContain('build-android:');
    });
  });

  describe('Release Tag Deployment Workflow', () => {
    it('generates valid YAML triggering on tags matching pattern and workflow_dispatch', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          releaseTagPattern: 'v*',
          storePublishing: false,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(yaml).toContain("tags:\n      - 'v*'");
      expect(yaml).toContain('workflow_dispatch:');
      expect(yaml).toContain('release-android:');
      expect(yaml).toContain('./gradlew bundleRelease');
      expect(yaml).toContain('path: android/app/build/outputs/bundle/release/*.aab');
      expect(yaml).toContain('Store publishing is disabled by default');
    });

    it('supports storePublishing=true with Android secret validation', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
          buildArtifact: 'aab',
        },
        githubActions: {
          ...getBaseConfig().githubActions,
          storePublishing: true,
        },
        signing: {
          ...getBaseConfig().signing,
          android: {
            keystoreSecretName: 'CUSTOM_KEYSTORE',
            keystorePasswordSecretName: 'CUSTOM_KEYSTORE_PWD',
            keyAliasSecretName: 'CUSTOM_ALIAS',
            keyPasswordSecretName: 'CUSTOM_ALIAS_PWD',
          },
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('name: Validate Store Credentials');
      expect(yaml).toContain('KEYSTORE_BASE64: ${{ secrets.CUSTOM_KEYSTORE }}');
      expect(yaml).toContain('KEYSTORE_PASSWORD: ${{ secrets.CUSTOM_KEYSTORE_PWD }}');
      expect(yaml).toContain('KEY_ALIAS: ${{ secrets.CUSTOM_ALIAS }}');
      expect(yaml).toContain('KEY_PASSWORD: ${{ secrets.CUSTOM_ALIAS_PWD }}');
    });

    it('generates release-notice job when android is disabled', () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: false,
        },
      });
      const project = createMockProject();

      const yaml = generateReleaseTagWorkflow(config, project);
      const validation = validateWorkflowYaml(yaml);

      expect(validation.valid).toBe(true);
      expect(yaml).toContain('release-notice:');
      expect(yaml).not.toContain('release-android:');
    });
  });

  describe('Package Manager Setup Matrix', () => {
    it('configures npm with npm ci and cache: npm', () => {
      const config = createMockConfig({ packageManager: 'npm' });
      const project = createMockProject({
        packageManager: {
          manager: 'npm',
          lockfile: 'package-lock.json',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'npm install',
          frozenInstallCommand: 'npm ci',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: npm');
      expect(yaml).toContain('run: npm ci');
      expect(yaml).not.toContain('Setup pnpm');
      expect(yaml).not.toContain('Setup Bun');
    });

    it('configures yarn classic with yarn install --frozen-lockfile and cache: yarn', () => {
      const config = createMockConfig({ packageManager: 'yarn' });
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: yarn');
      expect(yaml).toContain('run: yarn install --frozen-lockfile');
    });

    it('configures yarn berry with yarn install --immutable and cache: yarn', () => {
      const config = createMockConfig({ packageManager: 'yarn' });
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: false,
          isYarnBerry: true,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --immutable',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain('cache: yarn');
      expect(yaml).toContain('run: yarn install --immutable');
    });

    it('configures pnpm with setup-pnpm action and cache: pnpm', () => {
      const config = createMockConfig({ packageManager: 'pnpm' });
      const project = createMockProject({
        packageManager: {
          manager: 'pnpm',
          lockfile: 'pnpm-lock.yaml',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'pnpm install',
          frozenInstallCommand: 'pnpm install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.pnpmSetup}`);
      expect(yaml).toContain('run_install: false');
      expect(yaml).toContain('cache: pnpm');
      expect(yaml).toContain('run: pnpm install --frozen-lockfile');
    });

    it('configures bun with setup-bun action and no node cache', () => {
      const config = createMockConfig({ packageManager: 'bun' });
      const project = createMockProject({
        packageManager: {
          manager: 'bun',
          lockfile: 'bun.lockb',
          ambiguous: false,
          isYarnBerry: false,
          installCommand: 'bun install',
          frozenInstallCommand: 'bun install --frozen-lockfile',
        },
      });

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).toContain(`uses: ${GITHUB_ACTIONS_SHAS.setupBun}`);
      expect(yaml).toContain('run: bun install --frozen-lockfile');
      expect(yaml).not.toContain('cache: bun');
    });

    it('omits cache configuration when cacheDependencies is false', () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          cacheDependencies: false,
        },
      });
      const project = createMockProject();

      const yaml = generatePrValidationWorkflow(config, project);
      expect(yaml).not.toContain('cache: npm');
    });
  });

  describe('generateGitHubWorkflows Orchestrator', () => {
    it('generates all three enabled workflows by default', async () => {
      const config = createMockConfig();
      const project = createMockProject();

      const result = await generateGitHubWorkflows(config, project);
      expect(result.workflows).toHaveLength(3);
      expect(result.workflows.map((w) => w.id)).toEqual([
        'pr-validation',
        'main-build',
        'release-tag',
      ]);
      expect(result.warnings).toHaveLength(0);
    });

    it('respects workflow toggles in configuration', async () => {
      const config = createMockConfig({
        githubActions: {
          ...getBaseConfig().githubActions,
          workflows: {
            prValidation: true,
            mainBuild: false,
            releaseTag: false,
          },
        },
      });
      const project = createMockProject();

      const result = await generateGitHubWorkflows(config, project);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0]?.id).toBe('pr-validation');
    });

    it('emits a warning when android is enabled but native directory is missing', async () => {
      const config = createMockConfig({
        android: {
          ...getBaseConfig().android,
          enabled: true,
        },
      });
      const project = createMockProject({
        android: {
          hasAndroid: false,
          hasGradlew: false,
          buildGradleFound: false,
        },
      });

      const result = await generateGitHubWorkflows(config, project);
      expect(result.warnings.some((w) => w.includes('no "android/" directory was found'))).toBe(
        true,
      );
    });

    it('emits a warning when package manager detection is ambiguous', async () => {
      const config = createMockConfig();
      const project = createMockProject({
        packageManager: {
          manager: 'yarn',
          lockfile: 'yarn.lock',
          ambiguous: true,
          conflictingManagers: ['yarn', 'npm'],
          conflictingLockfiles: ['yarn.lock', 'package-lock.json'],
          isYarnBerry: false,
          installCommand: 'yarn install',
          frozenInstallCommand: 'yarn install --frozen-lockfile',
        },
      });

      const result = await generateGitHubWorkflows(config, project);
      expect(result.warnings.some((w) => w.includes('Ambiguous package manager detection'))).toBe(
        true,
      );
    });

    it('produces completely deterministic output across repeated invocations', async () => {
      const config = createMockConfig();
      const project = createMockProject();

      const run1 = await generateGitHubWorkflows(config, project);
      const run2 = await generateGitHubWorkflows(config, project);

      expect(run1.workflows.length).toBe(run2.workflows.length);
      for (let i = 0; i < run1.workflows.length; i++) {
        expect(run1.workflows[i]?.content).toBe(run2.workflows[i]?.content);
      }
    });
  });
});
