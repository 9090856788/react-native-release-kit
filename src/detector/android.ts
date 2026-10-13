import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFileUtf8 } from '../utils/fs.js';
import type { AndroidDetection } from './types.js';

export async function detectAndroid(projectDir: string = process.cwd()): Promise<AndroidDetection> {
  const androidDir = path.resolve(projectDir, 'android');
  if (!existsSync(androidDir)) {
    return {
      hasAndroid: false,
      packagePath: 'android',
      buildGradleFound: false,
      hasGradlew: false,
    };
  }

  const gradlewPath = path.resolve(androidDir, 'gradlew');
  const hasGradlew = existsSync(gradlewPath);

  const appBuildGradleGroovy = path.resolve(androidDir, 'app', 'build.gradle');
  const appBuildGradleKts = path.resolve(androidDir, 'app', 'build.gradle.kts');

  let buildGradlePath: string | null = null;
  if (existsSync(appBuildGradleGroovy)) {
    buildGradlePath = appBuildGradleGroovy;
  } else if (existsSync(appBuildGradleKts)) {
    buildGradlePath = appBuildGradleKts;
  }

  let applicationId: string | undefined;

  if (buildGradlePath) {
    try {
      const content = await readFileUtf8(buildGradlePath);
      // Match namespace = "com.foo" or namespace "com.foo"
      const namespaceMatch = content.match(/namespace\s*=?\s*["']([^"']+)["']/);
      // Match applicationId "com.foo" or applicationId = "com.foo"
      const appIdMatch = content.match(/applicationId\s*=?\s*["']([^"']+)["']/);

      applicationId = appIdMatch?.[1] || namespaceMatch?.[1];
    } catch {
      // Ignored if unreadable
    }
  }

  return {
    hasAndroid: true,
    packagePath: 'android',
    buildGradleFound: buildGradlePath !== null,
    applicationId,
    hasGradlew,
  };
}
