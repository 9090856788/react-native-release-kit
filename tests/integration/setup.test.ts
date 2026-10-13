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
});

