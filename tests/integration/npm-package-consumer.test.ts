import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

describe('Phase H Step 3 — Isolated Packed Package Consumer Test', () => {
  let tarballDir: string;
  let consumerDir: string;
  let tarballPath: string;
  const repoRoot = path.resolve(__dirname, '../../');

  beforeAll(async () => {
    tarballDir = path.join(
      tmpdir(),
      `rn-release-pack-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    consumerDir = path.join(
      tmpdir(),
      `rn-release-consumer-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );

    await fs.mkdir(tarballDir, { recursive: true });
    await fs.mkdir(consumerDir, { recursive: true });

    // 1. Pack the package into the isolated tarball directory
    const packResult = await execa('npm', ['pack', '--pack-destination', tarballDir], {
      cwd: repoRoot,
    });
    const tarballFileName = packResult.stdout.trim().split('\n').pop()!.trim();
    tarballPath = path.join(tarballDir, tarballFileName);
    expect(existsSync(tarballPath)).toBe(true);

    // 2. Unpack the tarball into consumerDir/node_modules/react-native-release-kit
    const pkgTargetDir = path.join(consumerDir, 'node_modules', 'react-native-release-kit');
    await fs.mkdir(pkgTargetDir, { recursive: true });

    // Tar extracts with a leading 'package/' directory; strip-components=1 unpacks root files directly into pkgTargetDir
    await execa('tar', ['-xzf', tarballPath, '--strip-components=1', '-C', pkgTargetDir]);

    // 3. Link runtime dependencies from repo node_modules to allow offline resolution
    const consumerNodeModules = path.join(consumerDir, 'node_modules');
    const runtimeDeps = ['@inquirer', 'commander', 'diff', 'execa', 'jiti', 'picocolors', 'zod'];

    for (const dep of runtimeDeps) {
      const srcDep = path.join(repoRoot, 'node_modules', dep);
      const destDep = path.join(consumerNodeModules, dep);
      if (existsSync(srcDep) && !existsSync(destDep)) {
        await fs.mkdir(path.dirname(destDep), { recursive: true });
        await fs.symlink(srcDep, destDep, 'junction');
      }
    }

    // 4. Create .bin executable symlink
    const binDir = path.join(consumerNodeModules, '.bin');
    await fs.mkdir(binDir, { recursive: true });
    const binSource = path.join(pkgTargetDir, 'bin', 'react-native-release-kit.js');
    await fs.chmod(binSource, 0o755);
    const binDest = path.join(binDir, 'react-native-release-kit');
    await fs.symlink(binSource, binDest);

    // 5. Create consumer package.json and minimal android/ios project directories
    await fs.writeFile(
      path.join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          name: 'isolated-consumer-app',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies: {
            'react-native-release-kit': `file:${tarballPath}`,
            'react-native': '0.76.0',
          },
        },
        null,
        2,
      ),
    );

    // Create minimal android and ios directories to enable platform detection
    await fs.mkdir(path.join(consumerDir, 'android', 'app'), { recursive: true });
    await fs.writeFile(
      path.join(consumerDir, 'android', 'build.gradle'),
      '// Top-level build file\n',
    );
    await fs.writeFile(
      path.join(consumerDir, 'android', 'app', 'build.gradle'),
      'apply plugin: "com.android.application"\nandroid {\n  namespace "com.consumer.app"\n}\n',
    );

    await fs.mkdir(path.join(consumerDir, 'ios'), { recursive: true });
    await fs.writeFile(
      path.join(consumerDir, 'ios', 'Podfile'),
      'platform :ios, "13.4"\ntarget "ConsumerApp" do\nend\n',
    );
  }, 30000);

  afterAll(async () => {
    try {
      await fs.rm(tarballDir, { recursive: true, force: true });
      await fs.rm(consumerDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('runs the installed CLI executable from node_modules/.bin and displays help and current package version', async () => {
    const binPath = path.join(consumerDir, 'node_modules', '.bin', 'react-native-release-kit');
    expect(existsSync(binPath)).toBe(true);

    const helpRes = await execa(binPath, ['--help'], { cwd: consumerDir });
    expect(helpRes.exitCode).toBe(0);
    expect(helpRes.stdout).toContain('react-native-release-kit');
    expect(helpRes.stdout).toContain('init');
    expect(helpRes.stdout).toContain('doctor');
    expect(helpRes.stdout).toContain('setup');
    expect(helpRes.stdout).toContain('build');
    expect(helpRes.stdout).toContain('deploy');

    const rootPkg = JSON.parse(
      await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    );
    const versionRes = await execa(binPath, ['--version'], { cwd: consumerDir });
    expect(versionRes.exitCode).toBe(0);
    expect(versionRes.stdout.trim()).toBe(rootPkg.version);
  });

  it('executes init --yes and creates valid configuration in consumer project', async () => {
    const binPath = path.join(consumerDir, 'node_modules', '.bin', 'react-native-release-kit');
    const initRes = await execa(binPath, ['init', '--yes'], { cwd: consumerDir });
    expect(initRes.exitCode).toBe(0);

    const configPath = path.join(consumerDir, 'react-native-release.config.ts');
    expect(existsSync(configPath)).toBe(true);

    const configContent = await fs.readFile(configPath, 'utf8');
    expect(configContent).toContain('defineConfig');
    expect(configContent).toContain('isolated-consumer-app');
  });

  it('executes setup --provider github-actions --fastlane and generates workflows and fastlane files', async () => {
    const binPath = path.join(consumerDir, 'node_modules', '.bin', 'react-native-release-kit');
    const setupRes = await execa(binPath, ['setup', '--provider', 'github-actions', '--fastlane'], {
      cwd: consumerDir,
    });
    expect(setupRes.exitCode).toBe(0);

    const prWorkflow = path.join(consumerDir, '.github', 'workflows', 'pr-validation.yml');
    const mainWorkflow = path.join(consumerDir, '.github', 'workflows', 'main-build.yml');
    const releaseWorkflow = path.join(consumerDir, '.github', 'workflows', 'release-tag.yml');
    const fastlaneAppfile = path.join(consumerDir, 'fastlane', 'Appfile');
    const fastlaneFastfile = path.join(consumerDir, 'fastlane', 'Fastfile');

    expect(existsSync(prWorkflow)).toBe(true);
    expect(existsSync(mainWorkflow)).toBe(true);
    expect(existsSync(releaseWorkflow)).toBe(true);
    expect(existsSync(fastlaneAppfile)).toBe(true);
    expect(existsSync(fastlaneFastfile)).toBe(true);
  });

  it('allows ESM consumers to import and execute public API from react-native-release-kit', async () => {
    const testEsmScript = path.join(consumerDir, 'test-esm.mjs');
    await fs.writeFile(
      testEsmScript,
      `
      import { defineConfig, ReleaseKitConfigSchema } from 'react-native-release-kit';

      const config = defineConfig({
        projectName: 'esm-consumer',
        packageManager: 'npm',
      });

      const parsed = ReleaseKitConfigSchema.parse(config);
      if (parsed.projectName !== 'esm-consumer') {
        throw new Error('Unexpected projectName: ' + parsed.projectName);
      }
      console.log('ESM_SUCCESS');
      `,
    );

    const esmRes = await execa('node', [testEsmScript], { cwd: consumerDir });
    expect(esmRes.exitCode).toBe(0);
    expect(esmRes.stdout).toContain('ESM_SUCCESS');
  });

  it('allows CommonJS consumers to require and execute public API from react-native-release-kit', async () => {
    const testCjsScript = path.join(consumerDir, 'test-cjs.cjs');
    await fs.writeFile(
      testCjsScript,
      `
      const { defineConfig, ReleaseKitConfigSchema } = require('react-native-release-kit');

      const config = defineConfig({
        projectName: 'cjs-consumer',
        packageManager: 'yarn',
      });

      const parsed = ReleaseKitConfigSchema.parse(config);
      if (parsed.projectName !== 'cjs-consumer') {
        throw new Error('Unexpected projectName: ' + parsed.projectName);
      }
      console.log('CJS_SUCCESS');
      `,
    );

    const cjsRes = await execa('node', [testCjsScript], { cwd: consumerDir });
    expect(cjsRes.exitCode).toBe(0);
    expect(cjsRes.stdout).toContain('CJS_SUCCESS');
  });

  it('includes valid TypeScript declaration files for both ESM and CommonJS', async () => {
    const dtsEsm = path.join(
      consumerDir,
      'node_modules',
      'react-native-release-kit',
      'dist',
      'index.d.ts',
    );
    const dtsCjs = path.join(
      consumerDir,
      'node_modules',
      'react-native-release-kit',
      'dist',
      'index.d.cts',
    );

    expect(existsSync(dtsEsm)).toBe(true);
    expect(existsSync(dtsCjs)).toBe(true);

    const dtsContent = await fs.readFile(dtsEsm, 'utf8');
    expect(dtsContent).toContain('declare function defineConfig');
    expect(dtsContent).toContain('ReleaseKitConfig');

    const dtsCjsContent = await fs.readFile(dtsCjs, 'utf8');
    expect(dtsCjsContent).toContain('declare function defineConfig');
    expect(dtsCjsContent).toContain('ReleaseKitConfig');
  });

  it('includes static template files in the packaged package directory', async () => {
    const pkgTemplatesDir = path.join(
      consumerDir,
      'node_modules',
      'react-native-release-kit',
      'templates',
    );
    expect(existsSync(pkgTemplatesDir)).toBe(true);
    expect(existsSync(path.join(pkgTemplatesDir, 'README.md'))).toBe(true);
    expect(existsSync(path.join(pkgTemplatesDir, 'fastlane', 'Appfile'))).toBe(true);
    expect(existsSync(path.join(pkgTemplatesDir, 'fastlane', 'Fastfile.android'))).toBe(true);
    expect(existsSync(path.join(pkgTemplatesDir, 'fastlane', 'Fastfile.ios'))).toBe(true);
    expect(existsSync(path.join(pkgTemplatesDir, 'workflows', 'pr-validation.yml'))).toBe(true);
  });
});
