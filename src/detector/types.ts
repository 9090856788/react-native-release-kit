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

export interface AndroidSigningDetails {
  usesDebugSigningInRelease: boolean;
  hasReleaseSigningConfig: boolean;
  hasEnvBasedSigning: boolean;
  hasPropertyBasedSigning: boolean;
}

export interface AndroidDetection {
  hasAndroid: boolean;
  packagePath: string;
  buildGradleFound: boolean;
  applicationId?: string;
  namespace?: string;
  versionCode?: number;
  versionName?: string;
  hasGradlew: boolean;
  gradlewPath?: string;
  appModule?: string;
  detectedModules?: string[];
  flavors?: string[];
  hasSigningConfigEnv?: boolean;
  usesDebugSigningInRelease?: boolean;
  hasReleaseSigningConfig?: boolean;
  signingDetails?: AndroidSigningDetails;
}

export interface IOSDetection {
  hasIOS: boolean;
  packagePath: string;
  hasPodfile: boolean;
  workspace?: string;
  xcodeproj?: string;
  schemes: string[];
  bundleId?: string;
  hasUnresolvedBundleIdMacro?: boolean;
  isPlaceholderBundleId?: boolean;
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
