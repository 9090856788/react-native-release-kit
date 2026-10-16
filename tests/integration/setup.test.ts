import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setupCommand } from '../../src/commands/setup.js';
import { createProgram } from '../../src/cli/index.js';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';

describe('Setup Command Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-setup-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });

    // Set up standard react-native project package.json
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify(
        {
          name: 'sample-setup-app',
          dependencies: {
            'react-native': '0.76.0',
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
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function writeValidConfigFile(): Promise<void> {
    const configContent = `
import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'sample-setup-app',
  packageManager: 'npm',
  githubActions: {
    enabled: true,
    mainBranch: 'main',
    releaseTagPattern: 'v*',
    cacheDependencies: true,
  },
  android: {
    enabled: false,
  },
});
`;
    await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);
  }

  it('fails with exit code 1 if no configuration file exists', async () => {
    const exitCode = await setupCommand({ cwd: testDir });
    expect(exitCode).toBe(1);
  });

  it('fails with exit code 1 if an unsupported provider is requested', async () => {
    await writeValidConfigFile();
    const exitCode = await setupCommand({ cwd: testDir, provider: 'circleci' });
    expect(exitCode).toBe(1);
  });

  it('generates all 3 workflows in .github/workflows/ when run with standard configuration', async () => {
    await writeValidConfigFile();

    const exitCode = await setupCommand({ cwd: testDir, provider: 'github-actions' });
    expect(exitCode).toBe(0);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const prPath = path.join(workflowsDir, 'pr-validation.yml');
    const mainPath = path.join(workflowsDir, 'main-build.yml');
    const releasePath = path.join(workflowsDir, 'release-tag.yml');

    const prContent = await fs.readFile(prPath, 'utf-8');
    const mainContent = await fs.readFile(mainPath, 'utf-8');
    const releaseContent = await fs.readFile(releasePath, 'utf-8');

    expect(validateWorkflowYaml(prContent).valid).toBe(true);
    expect(validateWorkflowYaml(mainContent).valid).toBe(true);
    expect(validateWorkflowYaml(releaseContent).valid).toBe(true);

    expect(prContent).toContain('name: PR Validation');
    expect(mainContent).toContain('name: Main Branch Build');
    expect(releaseContent).toContain('name: Release Deployment');
  });

  it('supports --dry-run without creating files on disk', async () => {
    await writeValidConfigFile();

    const exitCode = await setupCommand({ cwd: testDir, dryRun: true });
    expect(exitCode).toBe(0);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const exists = await fs
      .stat(workflowsDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('supports --diff without creating files on disk', async () => {
    await writeValidConfigFile();

    const exitCode = await setupCommand({ cwd: testDir, diff: true });
    expect(exitCode).toBe(0);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const exists = await fs
      .stat(workflowsDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('refuses to overwrite existing modified workflow files without --force', async () => {
    await writeValidConfigFile();

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    await fs.mkdir(workflowsDir, { recursive: true });
    const prPath = path.join(workflowsDir, 'pr-validation.yml');
    await fs.writeFile(prPath, '# pre-existing custom workflow\nname: Custom PR\n');

    const exitCode = await setupCommand({ cwd: testDir });
    expect(exitCode).toBe(1);

    // Verify original content was not overwritten
    const content = await fs.readFile(prPath, 'utf-8');
    expect(content).toBe('# pre-existing custom workflow\nname: Custom PR\n');
  });

  it('successfully overwrites existing workflow files when --force is provided', async () => {
    await writeValidConfigFile();

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    await fs.mkdir(workflowsDir, { recursive: true });
    const prPath = path.join(workflowsDir, 'pr-validation.yml');
    await fs.writeFile(prPath, '# pre-existing custom workflow\nname: Custom PR\n');

    const exitCode = await setupCommand({ cwd: testDir, force: true });
    expect(exitCode).toBe(0);

    // Verify content was updated
    const content = await fs.readFile(prPath, 'utf-8');
    expect(content).toContain('name: PR Validation');
    expect(content).not.toContain('Custom PR');
  });

  it('detects identical workflow files without modifying them and without requiring --force', async () => {
    await writeValidConfigFile();

    // First run generates files
    const firstCode = await setupCommand({ cwd: testDir });
    expect(firstCode).toBe(0);

    // Second run without --force should succeed because files are identical
    const secondCode = await setupCommand({ cwd: testDir, force: false });
    expect(secondCode).toBe(0);
  });

  it('executes setup via Commander CLI with flags (--dry-run, --diff, --force)', async () => {
    await writeValidConfigFile();

    // Test --dry-run through CLI
    const program1 = createProgram();
    await program1.parseAsync([
      'node',
      'react-native-release-kit',
      '--cwd',
      testDir,
      'setup',
      '--dry-run',
    ]);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const exists = await fs
      .stat(workflowsDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    // Test --diff through CLI
    const program2 = createProgram();
    await program2.parseAsync([
      'node',
      'react-native-release-kit',
      '--cwd',
      testDir,
      'setup',
      '--diff',
    ]);

    const existsAfterDiff = await fs
      .stat(workflowsDir)
      .then(() => true)
      .catch(() => false);
    expect(existsAfterDiff).toBe(false);

    // Test normal creation through CLI
    const program3 = createProgram();
    await program3.parseAsync([
      'node',
      'react-native-release-kit',
      '--cwd',
      testDir,
      'setup',
      '--force',
    ]);

    const existsAfterForce = await fs
      .stat(workflowsDir)
      .then(() => true)
      .catch(() => false);
    expect(existsAfterForce).toBe(true);
  });

  it('generates iOS build and release jobs when iOS project is enabled and detected', async () => {
    // Create iOS project structure
    const iosDir = path.join(testDir, 'ios');
    await fs.mkdir(path.join(iosDir, 'SampleApp.xcworkspace'), { recursive: true });
    await fs.writeFile(path.join(iosDir, 'Podfile'), "platform :ios, '14.0'");

    const configContent = `
import { defineConfig } from 'react-native-release-kit';

export default defineConfig({
  projectName: 'sample-setup-app',
  packageManager: 'npm',
  githubActions: {
    enabled: true,
    mainBranch: 'main',
    releaseTagPattern: 'v*',
    cacheDependencies: true,
  },
  android: {
    enabled: false,
  },
  ios: {
    enabled: true,
    teamId: 'TESTTEAM12',
    uploadToTestFlight: true,
  },
});
`;
    await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

    const exitCode = await setupCommand({ cwd: testDir });
    expect(exitCode).toBe(0);

    const workflowsDir = path.join(testDir, '.github', 'workflows');
    const mainContent = await fs.readFile(path.join(workflowsDir, 'main-build.yml'), 'utf-8');
    const releaseContent = await fs.readFile(path.join(workflowsDir, 'release-tag.yml'), 'utf-8');

    expect(validateWorkflowYaml(mainContent).valid).toBe(true);
    expect(mainContent).toContain('build-ios:');
    expect(mainContent).toContain('Build iOS (Simulator Validation)');
    expect(mainContent).toContain('-workspace "ios/SampleApp.xcworkspace"');

    expect(validateWorkflowYaml(releaseContent).valid).toBe(true);
    expect(releaseContent).toContain('release-ios:');
    expect(releaseContent).toContain('Build & Archive iOS Release');
    expect(releaseContent).toContain('Validate iOS Release Signing Prerequisites');
    expect(releaseContent).toContain('Provision iOS Distribution Certificate & Profile');
    expect(releaseContent).toContain('EFFECTIVE_TEAM_ID="TESTTEAM12"');
    expect(releaseContent).toContain('Publish to Apple TestFlight');
  });

  describe('Fastlane Setup Integration (setup --fastlane)', () => {
    it('generates Fastlane Appfile and Fastfile for Android project', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-fastlane-app',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.sample.fastlaneapp',
  },
  ios: {
    enabled: false,
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const exitCode = await setupCommand({ cwd: testDir, fastlane: true, provider: 'none' });
      expect(exitCode).toBe(0);

      const appfilePath = path.join(testDir, 'fastlane', 'Appfile');
      const fastfilePath = path.join(testDir, 'fastlane', 'Fastfile');

      expect(
        await fs
          .stat(appfilePath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .stat(fastfilePath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      const appfileContent = await fs.readFile(appfilePath, 'utf-8');
      const fastfileContent = await fs.readFile(fastfilePath, 'utf-8');

      expect(appfileContent).toContain('com.sample.fastlaneapp');
      expect(fastfileContent).toContain('platform :android');
      expect(fastfileContent).toContain('lane :deploy_internal');
      expect(fastfileContent).toContain('lane :deploy_production');
      expect(fastfileContent).not.toContain('platform :ios');
    });

    it('generates Fastlane Appfile and Fastfile for iOS project', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-ios-fastlane-app',
  packageManager: 'npm',
  android: {
    enabled: false,
  },
  ios: {
    enabled: true,
    bundleId: 'com.sample.iosfastlane',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const exitCode = await setupCommand({ cwd: testDir, fastlane: true, provider: 'none' });
      expect(exitCode).toBe(0);

      const appfilePath = path.join(testDir, 'fastlane', 'Appfile');
      const fastfilePath = path.join(testDir, 'fastlane', 'Fastfile');

      const appfileContent = await fs.readFile(appfilePath, 'utf-8');
      const fastfileContent = await fs.readFile(fastfilePath, 'utf-8');

      expect(appfileContent).toContain('com.sample.iosfastlane');
      expect(fastfileContent).toContain('platform :ios');
      expect(fastfileContent).toContain('lane :deploy_testflight');
      expect(fastfileContent).not.toContain('platform :android');
    });

    it('refuses to overwrite existing modified Fastlane files without --force', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-fastlane-app',
  packageManager: 'npm',
  android: {
    enabled: true,
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const fastlaneDir = path.join(testDir, 'fastlane');
      await fs.mkdir(fastlaneDir, { recursive: true });
      const appfilePath = path.join(fastlaneDir, 'Appfile');
      await fs.writeFile(appfilePath, '# custom user appfile\n');

      const exitCode = await setupCommand({ cwd: testDir, fastlane: true, provider: 'none' });
      expect(exitCode).toBe(1);

      const content = await fs.readFile(appfilePath, 'utf-8');
      expect(content).toBe('# custom user appfile\n');
    });

    it('overwrites existing modified Fastlane files when --force is provided', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-fastlane-app',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.forced.app',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const fastlaneDir = path.join(testDir, 'fastlane');
      await fs.mkdir(fastlaneDir, { recursive: true });
      const appfilePath = path.join(fastlaneDir, 'Appfile');
      await fs.writeFile(appfilePath, '# custom user appfile\n');

      const exitCode = await setupCommand({
        cwd: testDir,
        fastlane: true,
        provider: 'none',
        force: true,
      });
      expect(exitCode).toBe(0);

      const content = await fs.readFile(appfilePath, 'utf-8');
      expect(content).toContain('com.forced.app');
      expect(content).not.toContain('custom user appfile');
    });

    it('supports --dry-run for Fastlane files without writing disk', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-fastlane-app',
  packageManager: 'npm',
  android: {
    enabled: true,
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const exitCode = await setupCommand({
        cwd: testDir,
        fastlane: true,
        provider: 'none',
        dryRun: true,
      });
      expect(exitCode).toBe(0);

      const fastlaneDir = path.join(testDir, 'fastlane');
      const exists = await fs
        .stat(fastlaneDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('executes setup --fastlane via Commander CLI', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-cli-fastlane',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.cli.fastlane',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'react-native-release-kit',
        '--cwd',
        testDir,
        'setup',
        '--fastlane',
        '--force',
      ]);

      const appfilePath = path.join(testDir, 'fastlane', 'Appfile');
      expect(
        await fs
          .stat(appfilePath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
    });

    it('creates root Gemfile when --fastlane is enabled and omits it when Fastlane is disabled', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-fastlane-gemfile',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.sample.gemfileapp',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      // When fastlane is NOT enabled, Gemfile should not be created
      const noFastlaneCode = await setupCommand({
        cwd: testDir,
        provider: 'none',
        fastlane: false,
      });
      expect(noFastlaneCode).toBe(0);
      expect(
        await fs
          .stat(path.join(testDir, 'Gemfile'))
          .then(() => true)
          .catch(() => false),
      ).toBe(false);

      // When fastlane IS enabled, root Gemfile should be created
      const fastlaneCode = await setupCommand({ cwd: testDir, provider: 'none', fastlane: true });
      expect(fastlaneCode).toBe(0);
      const gemfilePath = path.join(testDir, 'Gemfile');
      expect(
        await fs
          .stat(gemfilePath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      const gemfileContent = await fs.readFile(gemfilePath, 'utf-8');
      expect(gemfileContent).toContain("source 'https://rubygems.org'");
      expect(gemfileContent).toContain("gem 'fastlane'");
    });

    it('preserves existing modified root Gemfile without --force and overwrites with --force', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-custom-gemfile',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.sample.customgemfile',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      const gemfilePath = path.join(testDir, 'Gemfile');
      await fs.writeFile(gemfilePath, "# User custom Gemfile\ngem 'cocoapods'\n");

      // Attempt setup without force -> should fail with exit code 1
      const exitCodeFail = await setupCommand({ cwd: testDir, fastlane: true, provider: 'none' });
      expect(exitCodeFail).toBe(1);

      // Content must be untouched
      const untouchedContent = await fs.readFile(gemfilePath, 'utf-8');
      expect(untouchedContent).toBe("# User custom Gemfile\ngem 'cocoapods'\n");

      // Attempt setup with force -> should succeed
      const exitCodeSuccess = await setupCommand({
        cwd: testDir,
        fastlane: true,
        provider: 'none',
        force: true,
      });
      expect(exitCodeSuccess).toBe(0);

      const overwrittenContent = await fs.readFile(gemfilePath, 'utf-8');
      expect(overwrittenContent).toContain("gem 'fastlane'");
      expect(overwrittenContent).not.toContain('cocoapods');
    });

    it('is idempotent for Fastlane files and Gemfile across multiple setup runs', async () => {
      const configContent = `
import { defineConfig } from 'react-native-release-kit';
export default defineConfig({
  projectName: 'sample-idempotent-fastlane',
  packageManager: 'npm',
  android: {
    enabled: true,
    applicationId: 'com.sample.idempotent',
  },
});
`;
      await fs.writeFile(path.join(testDir, 'react-native-release.config.ts'), configContent);

      // First run generates files
      const firstRun = await setupCommand({ cwd: testDir, fastlane: true, provider: 'none' });
      expect(firstRun).toBe(0);

      // Second run without force should succeed because files are identical
      const secondRun = await setupCommand({
        cwd: testDir,
        fastlane: true,
        provider: 'none',
        force: false,
      });
      expect(secondRun).toBe(0);
    });
  });
});
