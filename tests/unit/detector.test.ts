import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  detectPackageManager,
  detectAndroid,
  detectIOS,
  detectProject,
} from '../../src/detector/index.js';

describe('Project & Environment Detectors', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('detectPackageManager', () => {
    it('detects yarn classic when yarn.lock is present without berry config', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('yarn');
      expect(pm.lockfile).toBe('yarn.lock');
      expect(pm.isYarnBerry).toBe(false);
      expect(pm.frozenInstallCommand).toBe('yarn install --frozen-lockfile');
      expect(pm.ambiguous).toBe(false);
    });

    it('detects yarn berry when .yarnrc.yml is present', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      await fs.writeFile(path.join(testDir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('yarn');
      expect(pm.lockfile).toBe('yarn.lock');
      expect(pm.isYarnBerry).toBe(true);
      expect(pm.frozenInstallCommand).toBe('yarn install --immutable');
      expect(pm.ambiguous).toBe(false);
    });

    it('detects pnpm when pnpm-lock.yaml is present', async () => {
      await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('pnpm');
      expect(pm.lockfile).toBe('pnpm-lock.yaml');
      expect(pm.frozenInstallCommand).toBe('pnpm install --frozen-lockfile');
    });

    it('detects bun when bun.lockb is present', async () => {
      await fs.writeFile(path.join(testDir, 'bun.lockb'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('bun');
      expect(pm.lockfile).toBe('bun.lockb');
      expect(pm.frozenInstallCommand).toBe('bun install --frozen-lockfile');
    });

    it('detects bun when bun.lock is present', async () => {
      await fs.writeFile(path.join(testDir, 'bun.lock'), '');
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('bun');
      expect(pm.lockfile).toBe('bun.lock');
      expect(pm.frozenInstallCommand).toBe('bun install --frozen-lockfile');
    });

    it('detects conflicting lockfiles and marks detection as ambiguous', async () => {
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');
      await fs.writeFile(path.join(testDir, 'package-lock.json'), '{}');
      const pm = detectPackageManager(testDir);
      expect(pm.ambiguous).toBe(true);
      expect(pm.conflictingManagers).toEqual(['yarn', 'npm']);
      expect(pm.conflictingLockfiles).toEqual(['yarn.lock', 'package-lock.json']);
    });

    it('detects parent directory lockfile in monorepo scenario', async () => {
      const subDir = path.join(testDir, 'packages', 'app');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), '');
      const pm = detectPackageManager(subDir);
      expect(pm.manager).toBe('pnpm');
      expect(pm.lockfile).toBe('pnpm-lock.yaml');
      expect(pm.ambiguous).toBe(false);
    });

    it('defaults to npm if no lockfile found', () => {
      const pm = detectPackageManager(testDir);
      expect(pm.manager).toBe('npm');
      expect(pm.lockfile).toBeNull();
      expect(pm.frozenInstallCommand).toBe('npm ci');
      expect(pm.ambiguous).toBe(false);
    });
  });

  describe('detectAndroid', () => {
    it('returns hasAndroid=false when no android directory exists', async () => {
      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(false);
      expect(res.buildGradleFound).toBe(false);
    });

    it('detects Android structure and applicationId from build.gradle', async () => {
      const appDir = path.join(testDir, 'android', 'app');
      await fs.mkdir(appDir, { recursive: true });
      await fs.writeFile(
        path.join(appDir, 'build.gradle'),
        `
        android {
            namespace "com.awesome.myapp"
            defaultConfig {
                applicationId "com.awesome.myapp"
            }
        }
        `,
      );
      await fs.writeFile(path.join(testDir, 'android', 'gradlew'), '#!/bin/sh');

      const res = await detectAndroid(testDir);
      expect(res.hasAndroid).toBe(true);
      expect(res.buildGradleFound).toBe(true);
      expect(res.applicationId).toBe('com.awesome.myapp');
      expect(res.hasGradlew).toBe(true);
    });
  });

  describe('detectIOS', () => {
    it('returns hasIOS=false when no ios directory exists', async () => {
      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(false);
      expect(res.schemes).toEqual([]);
    });

    it('detects workspace, scheme, and Podfile', async () => {
      const iosDir = path.join(testDir, 'ios');
      await fs.mkdir(path.join(iosDir, 'AwesomeApp.xcworkspace'), { recursive: true });
      await fs.writeFile(path.join(iosDir, 'Podfile'), "platform :ios, '13.4'");

      const res = await detectIOS(testDir);
      expect(res.hasIOS).toBe(true);
      expect(res.hasPodfile).toBe(true);
      expect(res.workspace).toBe('ios/AwesomeApp.xcworkspace');
      expect(res.schemes).toContain('AwesomeApp');
    });
  });

  describe('detectProject', () => {
    it('detects React Native project details from package.json', async () => {
      const pkg = {
        name: 'sample-rn-app',
        dependencies: {
          react: '18.3.1',
          'react-native': '0.76.1',
        },
        scripts: {
          lint: 'eslint .',
          test: 'jest',
        },
      };
      await fs.writeFile(path.join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));
      await fs.writeFile(path.join(testDir, 'yarn.lock'), '');

      const res = await detectProject(testDir);
      expect(res.isReactNative).toBe(true);
      expect(res.reactNativeVersion).toBe('0.76.1');
      expect(res.projectName).toBe('sample-rn-app');
      expect(res.packageManager.manager).toBe('yarn');
      expect(res.scripts.lint).toBe('eslint .');
    });

    it('reports isReactNative=false if react-native is missing', async () => {
      const pkg = {
        name: 'regular-node-lib',
        dependencies: {
          lodash: '4.17.21',
        },
      };
      await fs.writeFile(path.join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));

      const res = await detectProject(testDir);
      expect(res.isReactNative).toBe(false);
      expect(res.reactNativeVersion).toBeUndefined();
    });
  });
});
