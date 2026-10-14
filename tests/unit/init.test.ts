import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateConfigFileContent, initCommand } from '../../src/commands/init.js';
import { loadConfig } from '../../src/config/loader.js';

describe('Init Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-init-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('generates valid TypeScript, JavaScript, and JSON content with correct iOS secrets', () => {
    const mockConfig = {
      projectName: 'SampleProject',
      packageManager: 'npm' as const,
    };

    const tsContent = generateConfigFileContent(mockConfig, 'ts');
    expect(tsContent).toContain("import { defineConfig } from 'react-native-release-kit'");
    expect(tsContent).toContain('SampleProject');

    const jsContent = generateConfigFileContent(mockConfig, 'js');
    expect(jsContent).toContain("require('react-native-release-kit')");

    const jsonContent = generateConfigFileContent(mockConfig, 'json');
    const parsed = JSON.parse(jsonContent);
    expect(parsed.projectName).toBe('SampleProject');
  });

  it('runs init with --yes and generates primary react-native-release.config.ts by default', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'my-mobile-app',
        dependencies: {
          'react-native': '0.76.2',
        },
      }),
    );

    // Call init without format parameter - must default to .ts
    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
    });

    expect(exitCode).toBe(0);
    const tsConfigPath = path.join(testDir, 'react-native-release.config.ts');
    expect(existsSync(tsConfigPath)).toBe(true);

    const content = await fs.readFile(tsConfigPath, 'utf-8');
    expect(content).toContain("import { defineConfig } from 'react-native-release-kit'");
    expect(content).toContain('APP_STORE_CONNECT_API_KEY_KEY_CONTENT');

    const loaded = await loadConfig(testDir);
    expect(loaded.config).toBeDefined();
    expect(loaded.config?.projectName).toBe('my-mobile-app');
    expect(loaded.config?.signing.ios.appStoreConnectKeyContentSecretName).toBe(
      'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
    );
  });

  it('respects --dry-run and does not create file', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'my-mobile-app',
        dependencies: {
          'react-native': '0.76.2',
        },
      }),
    );

    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
      dryRun: true,
    });

    expect(exitCode).toBe(0);
    const configPath = path.join(testDir, 'react-native-release.config.ts');
    expect(existsSync(configPath)).toBe(false);
  });

  it('dry-run previews the exact format requested and diffs against existing config', async () => {
    const existingJson = path.join(testDir, 'react-native-release.config.json');
    await fs.writeFile(existingJson, JSON.stringify({ projectName: 'old-app' }, null, 2));

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'new-app',
        dependencies: { 'react-native': '0.76.2' },
      }),
    );

    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
      dryRun: true,
      format: 'json',
    });

    expect(exitCode).toBe(0);
    // Existing file should remain untouched
    const content = await fs.readFile(existingJson, 'utf-8');
    expect(content).toContain('old-app');
  });

  it('refuses to overwrite existing config when non-interactive without --force', async () => {
    const configPath = path.join(testDir, 'react-native-release.config.ts');
    await fs.writeFile(configPath, 'export default { projectName: "old" };');

    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
      force: false,
    });

    expect(exitCode).toBe(1);
    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('old');
  });

  it('cleans up obsolete conflicting config file when overwriting with --force', async () => {
    const oldJsonPath = path.join(testDir, 'react-native-release.config.json');
    await fs.writeFile(oldJsonPath, JSON.stringify({ projectName: 'obsolete-json-app' }));

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'upgraded-ts-app',
        dependencies: { 'react-native': '0.76.2' },
      }),
    );

    // Run init to create default .ts with --force
    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
      force: true,
    });

    expect(exitCode).toBe(0);
    const newTsPath = path.join(testDir, 'react-native-release.config.ts');
    expect(existsSync(newTsPath)).toBe(true);
    // Old JSON file must have been cleaned up to prevent conflicting files
    expect(existsSync(oldJsonPath)).toBe(false);

    const loaded = await loadConfig(testDir);
    expect(loaded.config?.projectName).toBe('upgraded-ts-app');
    expect(loaded.warnings).toBeUndefined();
  });

  it('does not inject npm run typecheck when package.json has lint and test but no typecheck script', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'vaultguard-mock',
        dependencies: {
          'react-native': '0.76.2',
        },
        scripts: {
          lint: 'eslint .',
          test: 'jest',
        },
      }),
    );

    const exitCode = await initCommand({
      cwd: testDir,
      yes: true,
    });

    expect(exitCode).toBe(0);
    const newTsPath = path.join(testDir, 'react-native-release.config.ts');
    expect(existsSync(newTsPath)).toBe(true);

    const content = await fs.readFile(newTsPath, 'utf-8');
    expect(content).toContain('lint');
    expect(content).toContain('test');
    expect(content).not.toContain('npm run typecheck');
    expect(content).not.toContain('"typecheck"');

    const loaded = await loadConfig(testDir);
    expect(loaded.config?.scripts.lint).toBe('npm run lint');
    expect(loaded.config?.scripts.test).toBe('npm test');
    expect(loaded.config?.scripts.typecheck).toBeUndefined();
  });
});
