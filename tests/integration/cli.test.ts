import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { createProgram } from '../../src/cli/index.js';

const repoRoot = path.resolve(__dirname, '../../');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

describe('CLI Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-cli-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('exposes expected commands on program instance and matches package version', () => {
    const program = createProgram();
    expect(program.version()).toBe(packageJson.version);
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain('init');
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('setup');
    expect(commandNames).toContain('build');
    expect(commandNames).toContain('deploy');
  });

  it('ensures CLI version matches package.json version and cannot become stale', async () => {
    const program = createProgram();
    expect(program.version()).toBe(packageJson.version);
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);

    const binPath = path.join(repoRoot, 'bin/react-native-release-kit.js');
    const versionRes = await execa('node', [binPath, '--version'], { cwd: repoRoot });
    expect(versionRes.exitCode).toBe(0);
    expect(versionRes.stdout.trim()).toBe(packageJson.version);

    const shortVersionRes = await execa('node', [binPath, '-v'], { cwd: repoRoot });
    expect(shortVersionRes.exitCode).toBe(0);
    expect(shortVersionRes.stdout.trim()).toBe(packageJson.version);
  });

  it('verifies version injection works for both ESM and CommonJS builds', async () => {
    const esmPath = path.join(repoRoot, 'dist/cli/index.js');
    const cjsPath = path.join(repoRoot, 'dist/cli/index.cjs');

    if (!existsSync(esmPath) || !existsSync(cjsPath)) {
      await execa('npm', ['run', 'build'], { cwd: repoRoot });
    }

    // 1. Verify ESM build
    const esmModule = await import(pathToFileURL(esmPath).href);
    const esmProgram = esmModule.createProgram();
    expect(esmProgram.version()).toBe(packageJson.version);

    // 2. Verify CommonJS build
    const require = createRequire(import.meta.url);
    const cjsModule = require(cjsPath);
    const cjsProgram = cjsModule.createProgram();
    expect(cjsProgram.version()).toBe(packageJson.version);
  });

  it('runs doctor with --json flag through CLI program', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-cli-app',
        dependencies: {
          'react-native': '0.76.0',
        },
      }),
    );

    const program = createProgram();
    let stdoutBuffer = '';
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdoutBuffer += msg + '\n';
    };

    try {
      await program.parseAsync([
        'node',
        'react-native-release-kit',
        '--cwd',
        testDir,
        'doctor',
        '--skip-android',
        '--skip-ios',
        '--json',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(stdoutBuffer).toContain('"passed"');
    const parsed = JSON.parse(stdoutBuffer);
    expect(parsed.checks).toBeDefined();
  });

  it('runs init, doctor, and setup in agreement on react-native-release.config.ts by default', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'cli-test-app',
        dependencies: {
          'react-native': '0.76.0',
        },
      }),
    );

    // 1. Run init --yes (defaults to .ts)
    const initProgram = createProgram();
    await initProgram.parseAsync([
      'node',
      'react-native-release-kit',
      '--cwd',
      testDir,
      'init',
      '--yes',
    ]);

    const generatedFile = path.join(testDir, 'react-native-release.config.ts');
    const exists = await fs
      .stat(generatedFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const content = await fs.readFile(generatedFile, 'utf-8');
    expect(content).toContain("import { defineConfig } from 'react-native-release-kit'");

    // 2. Run doctor --json and verify it detected and loaded react-native-release.config.ts
    const doctorProgram = createProgram();
    let doctorOutput = '';
    const originalLog = console.log;
    console.log = (msg: string) => {
      doctorOutput += msg + '\n';
    };
    try {
      await doctorProgram.parseAsync([
        'node',
        'react-native-release-kit',
        '--cwd',
        testDir,
        'doctor',
        '--skip-android',
        '--skip-ios',
        '--json',
      ]);
    } finally {
      console.log = originalLog;
    }

    const doctorReport = JSON.parse(doctorOutput);
    const configCheck = doctorReport.checks.find((c: { id: string }) => c.id === 'config-file');
    expect(configCheck).toBeDefined();
    expect(configCheck.status).toBe('pass');
    expect(configCheck.message).toContain('react-native-release.config.ts');

    // 3. Run setup and verify it succeeds and agrees with the configuration
    const setupProgram = createProgram();
    await setupProgram.parseAsync([
      'node',
      'react-native-release-kit',
      '--cwd',
      testDir,
      'setup',
      '--provider',
      'github-actions',
    ]);
  });
});
