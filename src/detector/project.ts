import path from 'node:path';
import { readJsonFile } from '../utils/fs.js';
import { detectPackageManager } from './package-manager.js';
import { detectAndroid } from './android.js';
import { detectIOS } from './ios.js';
import type { ProjectDetectionResult } from './types.js';

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectProjectOptions {
  androidPackagePath?: string;
  androidAppModule?: string;
  iosPackagePath?: string;
}

export async function detectProject(
  projectDir: string = process.cwd(),
  options: DetectProjectOptions = {},
): Promise<ProjectDetectionResult> {
  const packageJsonPath = path.resolve(projectDir, 'package.json');
  const pkg = await readJsonFile<PackageJsonShape>(packageJsonPath);

  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const reactNativeVersion = deps['react-native'];
  const isReactNative = typeof reactNativeVersion === 'string';

  const projectName = pkg?.name || path.basename(projectDir);
  const packageManager = detectPackageManager(projectDir);
  const android = await detectAndroid(projectDir, {
    packagePath: options.androidPackagePath,
    appModule: options.androidAppModule,
  });
  const ios = await detectIOS(projectDir, {
    packagePath: options.iosPackagePath,
  });

  return {
    isReactNative,
    reactNativeVersion,
    projectName,
    packageJsonPath,
    packageManager,
    android,
    ios,
    scripts: pkg?.scripts ?? {},
  };
}
