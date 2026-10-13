import path from 'node:path';
import { existsSync } from 'node:fs';
import { safeExec } from '../utils/process.js';
import { detectProject } from '../detector/project.js';
import { loadConfig } from '../config/loader.js';
import type { DoctorCheckItem, DoctorReport } from './types.js';

export interface DoctorOptions {
  cwd?: string;
  skipAndroid?: boolean;
  skipIOS?: boolean;
}

export async function runDoctorChecks(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const checks: DoctorCheckItem[] = [];

  // 1. Node.js LTS check
  const nodeVersionStr = process.version; // e.g. "v24.21.0"
  const majorNodeVersion = parseInt(nodeVersionStr.replace(/^v/, '').split('.')[0] || '0', 10);
  if (majorNodeVersion >= 18) {
    checks.push({
      id: 'node-lts',
      category: 'environment',
      title: 'Node.js LTS Compatibility',
      status: 'pass',
      message: `Node.js version ${nodeVersionStr} is supported (>= 18.0.0).`,
    });
  } else {
    checks.push({
      id: 'node-lts',
      category: 'environment',
      title: 'Node.js LTS Compatibility',
      status: 'fail',
      message: `Node.js version ${nodeVersionStr} is too old. Required: >= 18.0.0.`,
      remediation:
        'Please upgrade to an Active or Maintenance Node.js LTS release (Node 18, 20, 22).',
    });
  }

  // 2. React Native project structure
  const project = await detectProject(cwd);
  if (project.isReactNative) {
    checks.push({
      id: 'rn-project',
      category: 'environment',
      title: 'React Native Project Detection',
      status: 'pass',
      message: `Detected React Native ${project.reactNativeVersion} in "${project.projectName}".`,
    });
  } else {
    checks.push({
      id: 'rn-project',
      category: 'environment',
      title: 'React Native Project Detection',
      status: 'fail',
      message: 'No react-native dependency found in package.json.',
      remediation: 'Run react-native-release-kit within the root of a React Native CLI project.',
    });
  }

  // 3. Package Manager
  checks.push({
    id: 'package-manager',
    category: 'environment',
    title: 'Package Manager',
    status: 'pass',
    message: `Detected package manager: ${project.packageManager.manager}${
      project.packageManager.lockfile ? ` (lockfile: ${project.packageManager.lockfile})` : ''
    }.`,
  });

  // 4. Configuration Check
  const configResult = await loadConfig(cwd);
  if (configResult.config) {
    checks.push({
      id: 'config-file',
      category: 'config',
      title: 'Release Kit Configuration',
      status: 'pass',
      message: `Valid configuration loaded from ${path.basename(configResult.configPath!)}.`,
    });
  } else if (configResult.configPath && configResult.error) {
    checks.push({
      id: 'config-file',
      category: 'config',
      title: 'Release Kit Configuration',
      status: 'fail',
      message: configResult.error,
      remediation: 'Fix configuration syntax and schema violations in your config file.',
    });
  } else {
    checks.push({
      id: 'config-file',
      category: 'config',
      title: 'Release Kit Configuration',
      status: 'warn',
      message: 'No react-native-release.config.ts found.',
      remediation: 'Run "npx react-native-release-kit init" to generate your configuration.',
    });
  }

  if (configResult.warnings && configResult.warnings.length > 0) {
    for (const warningMsg of configResult.warnings) {
      checks.push({
        id: 'config-precedence',
        category: 'config',
        title: 'Conflicting Configuration Files',
        status: 'warn',
        message: warningMsg,
        remediation:
          'Keep only one primary configuration file (prefer react-native-release.config.ts) and delete obsolete configs.',
      });
    }
  }

  // 5. Android Environment Checks (unless skipped)
  if (!options.skipAndroid) {
    // Java Check
    const javaHome = process.env.JAVA_HOME;
    const javaExec = await safeExec('java', ['-version'], { silent: true });
    if (javaExec.exitCode === 0 || javaHome) {
      checks.push({
        id: 'android-java',
        category: 'android',
        title: 'Java Development Kit (JDK)',
        status: 'pass',
        message: javaHome
          ? `JAVA_HOME is configured at: ${javaHome}`
          : 'java binary is accessible in PATH.',
      });
    } else {
      checks.push({
        id: 'android-java',
        category: 'android',
        title: 'Java Development Kit (JDK)',
        status: 'fail',
        message: 'JDK not found. Neither JAVA_HOME nor java command is available.',
        remediation: 'Install OpenJDK 17 and set JAVA_HOME in your shell profile.',
      });
    }

    // Android SDK Check
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (androidHome && existsSync(androidHome)) {
      checks.push({
        id: 'android-sdk',
        category: 'android',
        title: 'Android SDK Location',
        status: 'pass',
        message: `Android SDK located at: ${androidHome}`,
      });
    } else {
      checks.push({
        id: 'android-sdk',
        category: 'android',
        title: 'Android SDK Location',
        status: 'warn',
        message: 'ANDROID_HOME environment variable is not set or directory does not exist.',
        remediation:
          'Export ANDROID_HOME (e.g. export ANDROID_HOME=$HOME/Library/Android/sdk on macOS).',
      });
    }

    // Android Native Folder Check
    if (project.android.hasAndroid) {
      if (project.android.hasGradlew) {
        checks.push({
          id: 'android-gradlew',
          category: 'android',
          title: 'Android Gradle Wrapper',
          status: 'pass',
          message: 'Found android/gradlew script.',
        });
      } else {
        checks.push({
          id: 'android-gradlew',
          category: 'android',
          title: 'Android Gradle Wrapper',
          status: 'warn',
          message: 'android/gradlew script is missing.',
          remediation: 'Generate or restore the Gradle wrapper in your android/ directory.',
        });
      }
    }
  }

  // 6. iOS Environment Checks (unless skipped)
  if (!options.skipIOS) {
    const isDarwin = process.platform === 'darwin';
    if (!isDarwin) {
      checks.push({
        id: 'ios-darwin',
        category: 'ios',
        title: 'iOS Build Platform (macOS)',
        status: 'warn',
        message: `Current OS is ${process.platform}. iOS builds require macOS and Xcode.`,
        remediation: 'Run local iOS builds and setup on macOS, or use a macOS runner in CI.',
      });
    } else {
      // Xcode check
      const xcodeSelect = await safeExec('xcode-select', ['-p'], { silent: true });
      if (xcodeSelect.exitCode === 0) {
        checks.push({
          id: 'ios-xcode',
          category: 'ios',
          title: 'Xcode Developer Tools',
          status: 'pass',
          message: `Xcode Command Line Tools installed at: ${xcodeSelect.stdout.trim()}`,
        });
      } else {
        checks.push({
          id: 'ios-xcode',
          category: 'ios',
          title: 'Xcode Developer Tools',
          status: 'fail',
          message: 'Xcode Command Line Tools not detected.',
          remediation: 'Run "xcode-select --install" or install Xcode from the Mac App Store.',
        });
      }

      // CocoaPods check
      const podCheck = await safeExec('pod', ['--version'], { silent: true });
      if (podCheck.exitCode === 0) {
        checks.push({
          id: 'ios-cocoapods',
          category: 'ios',
          title: 'CocoaPods',
          status: 'pass',
          message: `CocoaPods version ${podCheck.stdout.trim()} is available.`,
        });
      } else {
        checks.push({
          id: 'ios-cocoapods',
          category: 'ios',
          title: 'CocoaPods',
          status: 'warn',
          message: 'CocoaPods ("pod") command not found in PATH.',
          remediation:
            'Install CocoaPods using "sudo gem install cocoapods" or "brew install cocoapods".',
        });
      }

      // iOS Project Folder Check
      if (project.ios.hasIOS) {
        checks.push({
          id: 'ios-project-files',
          category: 'ios',
          title: 'iOS Native Folder',
          status: 'pass',
          message: `Found ios/ directory${project.ios.workspace ? ` with workspace ${project.ios.workspace}` : ''}.`,
        });
      }
    }
  }

  const warnings = checks.filter((c) => c.status === 'warn').length;
  const errors = checks.filter((c) => c.status === 'fail').length;

  return {
    checks,
    passed: errors === 0,
    warnings,
    errors,
  };
}
