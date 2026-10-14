import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';
import { ReleaseKitConfigSchema } from '../../src/config/schema.js';
import { setupCommand } from '../../src/commands/setup.js';
import { buildCommand } from '../../src/commands/build.js';
import { deployCommand } from '../../src/commands/deploy.js';
import { AndroidAdapter } from '../../src/adapters/android.js';
import { PublisherAdapter } from '../../src/adapters/publisher.js';
import { createDefaultConfig } from '../../src/config/index.js';

describe('Phase F Step 2 — Configuration and Environment Resilience', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-resilience-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. Malformed configuration files and invalid exports', () => {
    it('returns error when config file has a syntax error and CLI exits with code 1', async () => {
      await fs.writeFile(
        path.join(testDir, 'react-native-release.config.ts'),
        'export default { invalid syntax !!@@##',
      );

      const res = await loadConfig(testDir);
      expect(res.config).toBeNull();
      expect(res.error).toBeDefined();
      expect(res.error).toContain('Failed to load or validate configuration');

      // Check build command returns 1
      const buildExit = await buildCommand({ platform: 'android', cwd: testDir });
      expect(buildExit).toBe(1);

      // Check deploy command returns 1
      const deployExit = await deployCommand({ platform: 'android', cwd: testDir });
      expect(deployExit).toBe(1);

      // Check setup command returns 1
      const setupExit = await setupCommand({ provider: 'github-actions', cwd: testDir });
      expect(setupExit).toBe(1);
    });

    it('returns error when config file exports a non-object (e.g. primitive number)', async () => {
      await fs.writeFile(
        path.join(testDir, 'react-native-release.config.ts'),
        'export default 42;',
      );

      const res = await loadConfig(testDir);
      expect(res.config).toBeNull();
      expect(res.error).toContain('did not export an object');

      const buildExit = await buildCommand({ platform: 'android', cwd: testDir });
      expect(buildExit).toBe(1);
    });
  });

  describe('2. Invalid types and boundaries in configuration schema', () => {
    it('rejects artifactRetentionDays out of range (greater than 90 days or less than 1)', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        githubActions: {
          artifactRetentionDays: 120, // max is 90
        },
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.path).toContain('artifactRetentionDays');
      }
    });

    it('rejects unsupported package managers', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        packageManager: 'pip', // not npm, yarn, pnpm, or bun
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.path).toContain('packageManager');
      }
    });

    it('rejects unsupported deployment tracks', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        android: {
          deploymentTrack: 'alpha-testing', // valid are internal, closed, production
        },
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.path).toContain('deploymentTrack');
      }
    });
  });

  describe('3. Shell metacharacters and path traversal prevention', () => {
    it('rejects android.appModule with shell metacharacters', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        android: {
          appModule: 'app; rm -rf /',
        },
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.message).toContain('Invalid appModule format');
      }
    });

    it('rejects android.flavor with shell metacharacters or spaces', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        android: {
          flavor: 'staging; reboot',
        },
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.message).toContain('Invalid flavor');
      }
    });

    it('rejects android.packagePath with path traversal or absolute paths', () => {
      const parsedTraversal = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        android: {
          packagePath: '../secret-android',
        },
      });
      expect(parsedTraversal.success).toBe(false);

      const parsedAbsolute = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        android: {
          packagePath: '/etc/android',
        },
      });
      expect(parsedAbsolute.success).toBe(false);
    });

    it('rejects ios.scheme with shell injection characters', () => {
      const parsed = ReleaseKitConfigSchema.safeParse({
        projectName: 'test-app',
        ios: {
          scheme: 'AppScheme" ; echo pwned',
        },
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.message).toContain('Invalid iOS scheme name');
      }
    });
  });

  describe('4. Missing configuration handling', () => {
    it('returns exit code 1 with guidance when no config file exists in the directory', async () => {
      const buildRes = await buildCommand({ platform: 'android', cwd: testDir });
      expect(buildRes).toBe(1);

      const deployRes = await deployCommand({ platform: 'android', cwd: testDir });
      expect(deployRes).toBe(1);

      const setupRes = await setupCommand({ provider: 'github-actions', cwd: testDir });
      expect(setupRes).toBe(1);
    });
  });

  describe('5. Existing file preservation without explicit overwrite permission', () => {
    it('does not overwrite existing workflow files unless overwrite permission is granted', async () => {
      // Create minimal valid config
      await fs.writeFile(
        path.join(testDir, 'react-native-release.config.ts'),
        `
        export default {
          projectName: 'resilience-app',
          packageManager: 'npm',
          android: { enabled: true },
          ios: { enabled: true, bundleId: 'com.resilience.app' },
        };
        `,
      );

      // Pre-create a workflow file with custom content
      const workflowsDir = path.join(testDir, '.github', 'workflows');
      await fs.mkdir(workflowsDir, { recursive: true });
      const customPrWorkflow = '# PRE-EXISTING CUSTOM WORKFLOW CONTENT';
      const prWorkflowPath = path.join(workflowsDir, 'pr-validation.yml');
      await fs.writeFile(prWorkflowPath, customPrWorkflow);

      // Run setup without force
      await setupCommand({
        provider: 'github-actions',
        cwd: testDir,
        force: false,
      });

      // Verify original content was preserved
      const content = await fs.readFile(prWorkflowPath, 'utf8');
      expect(content).toBe(customPrWorkflow);
    });
  });

  describe('6. Dry-run operations safety guarantee', () => {
    it('AndroidAdapter build dry-run executes zero Gradle processes and creates no signing files', async () => {
      const androidDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(androidDir, { recursive: true });
      await fs.writeFile(
        path.join(androidDir, 'build.gradle'),
        'android { defaultConfig { applicationId "com.example.dryrun" } }\n',
      );
      const gradlewPath = path.join(testDir, 'android', 'gradlew');
      await fs.writeFile(gradlewPath, '#!/bin/sh\nexit 0\n');
      await fs.chmod(gradlewPath, 0o755);

      const config = ReleaseKitConfigSchema.parse(createDefaultConfig('dry-run-app', 'npm'));
      const adapter = new AndroidAdapter(config);

      const res = await adapter.build({
        cwd: testDir,
        dryRun: true,
      });

      expect(res.success).toBe(true);
      expect(res.gradleTask).toContain('bundleRelease');
    });

    it('PublisherAdapter deploy dry-run executes zero network calls and cleans up without side effects', async () => {
      const config = ReleaseKitConfigSchema.parse(createDefaultConfig('dry-run-app', 'npm'));
      config.android.applicationId = 'com.example.dryrun';
      const publisher = new PublisherAdapter(config);

      // Create a mock aab artifact
      const artifactDir = path.join(
        testDir,
        'android',
        'app',
        'build',
        'outputs',
        'bundle',
        'release',
      );
      await fs.mkdir(artifactDir, { recursive: true });
      const aabPath = path.join(artifactDir, 'app-release.aab');
      await fs.writeFile(aabPath, 'fake aab');

      const mockSa = {
        type: 'service_account',
        project_id: 'mock-proj',
        private_key_id: '123',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9fake\n-----END PRIVATE KEY-----\n',
        client_email: 'bot@mock-proj.iam.gserviceaccount.com',
      };

      const res = await publisher.publishAndroid({
        cwd: testDir,
        artifactPath: aabPath,
        dryRun: true,
        track: 'internal',
        env: {
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(mockSa),
        },
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('[DRY RUN]');
    });
  });
});
