import type { PackageManager } from '../config/schema.js';

export interface PackageManagerDetection {
  manager: PackageManager;
  lockfile: string | null;
  ambiguous?: boolean;
  conflictingManagers?: PackageManager[];
  conflictingLockfiles?: string[];
  isYarnBerry?: boolean;
  installCommand?: string;
  frozenInstallCommand: string;
}

export interface AndroidDetection {
  hasAndroid: boolean;
  packagePath: string;
  buildGradleFound: boolean;
  applicationId?: string;
  hasGradlew: boolean;
}

export interface IOSDetection {
  hasIOS: boolean;
  packagePath: string;
  hasPodfile: boolean;
  workspace?: string;
  schemes: string[];
  bundleId?: string;
}

export interface ProjectDetectionResult {
  isReactNative: boolean;
  reactNativeVersion?: string;
  projectName: string;
  packageJsonPath: string;
  packageManager: PackageManagerDetection;
  android: AndroidDetection;
  ios: IOSDetection;
  scripts: Record<string, string>;
}
