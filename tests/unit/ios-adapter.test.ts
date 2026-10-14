import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { IOSAdapter } from '../../src/adapters/ios.js';
import { buildCommand } from '../../src/commands/build.js';
import { deployCommand } from '../../src/commands/deploy.js';
import { ReleaseKitConfigSchema, createDefaultConfig } from '../../src/config/index.js';
import type { ReleaseKitConfig } from '../../src/config/schema.js';

function createTestConfig(overrides: Partial<ReleaseKitConfig> = {}): ReleaseKitConfig {
  const base = ReleaseKitConfigSchema.parse(createDefaultConfig('test-ios-app', 'npm'));
  return {
    ...base,
    ...overrides,
    ios: {
      ...base.ios,
      enabled: true,
      bundleId: 'com.example.testapp',
      scheme: 'TestApp',
      ...(overrides.ios || {}),
    },
  };
}

describe('iOS Adapter & CLI Command Honesty', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      tmpdir(),
      `rn-release-ios-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });

    // Write a valid config file in testDir
    await fs.writeFile(
      path.join(testDir, 'react-native-release.config.ts'),
      `export default {
  projectName: 'test-ios-app',
  packageManager: 'npm',
  ios: {
    enabled: true,
    bundleId: 'com.example.testapp',
    scheme: 'TestApp',
  },
};`,
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('IOSAdapter.build returns success: false with actionable remediation', async () => {
    const config = createTestConfig();
    const adapter = new IOSAdapter(config);

    const result = await adapter.build({ artifact: 'ipa' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local native iOS build execution via CLI is not supported');
    expect(result.remediation).toContain('GitHub Actions workflows');
  });

  it('buildCommand returns exit code 1 when platform is ios', async () => {
    const exitCode = await buildCommand({
      cwd: testDir,
      platform: 'ios',
    });

    expect(exitCode).toBe(1);
  });

  it('deployCommand returns exit code 1 when platform is ios', async () => {
    const exitCode = await deployCommand({
      cwd: testDir,
      platform: 'ios',
      track: 'testflight',
    });

    expect(exitCode).toBe(1);
  });

  it('buildCommand rejects invalid platform with exit code 1', async () => {
    // @ts-expect-error Testing invalid runtime input
    const exitCode = await buildCommand({ cwd: testDir, platform: 'windows' });
    expect(exitCode).toBe(1);
  });

  it('deployCommand rejects invalid platform with exit code 1', async () => {
    // @ts-expect-error Testing invalid runtime input
    const exitCode = await deployCommand({ cwd: testDir, platform: 'windows' });
    expect(exitCode).toBe(1);
  });
});
