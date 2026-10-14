import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runDoctorChecks } from '../../src/validators/prerequisites.js';

describe('Doctor Prerequisite Checks', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-doc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('runs all checks and provides a structured report', async () => {
    // Write mock RN package.json
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: {
          'react-native': '0.76.0',
        },
      }),
    );

    const report = await runDoctorChecks({
      cwd: testDir,
      skipAndroid: true,
      skipIOS: true,
    });

    expect(report.checks.length).toBeGreaterThanOrEqual(3);

    const nodeCheck = report.checks.find((c) => c.id === 'node-lts');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.status).toBe('pass');

    const rnCheck = report.checks.find((c) => c.id === 'rn-project');
    expect(rnCheck).toBeDefined();
    expect(rnCheck?.status).toBe('pass');

    const configCheck = report.checks.find((c) => c.id === 'config-file');
    expect(configCheck).toBeDefined();
    expect(configCheck?.status).toBe('warn'); // warns because config is missing
  });

  it('detects missing react-native and reports failure', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'non-rn-app',
      }),
    );

    const report = await runDoctorChecks({
      cwd: testDir,
      skipAndroid: true,
      skipIOS: true,
    });

    const rnCheck = report.checks.find((c) => c.id === 'rn-project');
    expect(rnCheck?.status).toBe('fail');
    expect(rnCheck?.remediation).toBeDefined();
    expect(report.passed).toBe(false);
  });

  it('detects multiple conflicting configuration files and warns in doctor report', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: { 'react-native': '0.76.0' },
      }),
    );
    await fs.writeFile(
      path.join(testDir, 'react-native-release.config.ts'),
      'import { defineConfig } from "react-native-release-kit"; export default defineConfig({ projectName: "TSApp" });',
    );
    await fs.writeFile(
      path.join(testDir, 'react-native-release.config.json'),
      JSON.stringify({ projectName: 'JSONApp' }),
    );

    const report = await runDoctorChecks({
      cwd: testDir,
      skipAndroid: true,
      skipIOS: true,
    });

    const conflictCheck = report.checks.find((c) => c.id === 'config-precedence');
    expect(conflictCheck).toBeDefined();
    expect(conflictCheck?.status).toBe('warn');
    expect(conflictCheck?.message).toContain('Multiple configuration files found');
    expect(conflictCheck?.message).toContain('react-native-release.config.ts');
  });

  it('warns in doctor check when Android release build type uses signingConfigs.debug', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: { 'react-native': '0.76.0' },
      }),
    );
    const androidDir = path.join(testDir, 'android');
    const appDir = path.join(androidDir, 'app');
    await fs.mkdir(appDir, { recursive: true });

    await fs.writeFile(
      path.join(appDir, 'build.gradle'),
      `
android {
    namespace "com.vaultguard.app"
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`,
    );
    await fs.writeFile(path.join(androidDir, 'gradlew'), '#!/bin/sh\nexit 0\n');

    const report = await runDoctorChecks({
      cwd: testDir,
      skipAndroid: false,
      skipIOS: true,
    });

    const signingCheck = report.checks.find((c) => c.id === 'android-release-signing');
    expect(signingCheck).toBeDefined();
    expect(signingCheck?.status).toBe('warn');
    expect(signingCheck?.message).toContain('signingConfigs.debug');
    expect(signingCheck?.remediation).toContain('Configure a dedicated release signingConfig');
  });

  it('passes in doctor check when Android release build type has dedicated release signingConfig', async () => {
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: { 'react-native': '0.76.0' },
      }),
    );
    const androidDir = path.join(testDir, 'android');
    const appDir = path.join(androidDir, 'app');
    await fs.mkdir(appDir, { recursive: true });

    await fs.writeFile(
      path.join(appDir, 'build.gradle'),
      `
android {
    namespace "com.vaultguard.app"
    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`,
    );
    await fs.writeFile(path.join(androidDir, 'gradlew'), '#!/bin/sh\nexit 0\n');

    const report = await runDoctorChecks({
      cwd: testDir,
      skipAndroid: false,
      skipIOS: true,
    });

    const signingCheck = report.checks.find((c) => c.id === 'android-release-signing');
    expect(signingCheck).toBeDefined();
    expect(signingCheck?.status).toBe('pass');
    expect(signingCheck?.message).toContain('dedicated release signing configuration');
  });
});
