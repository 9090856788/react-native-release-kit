import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { input, select, confirm } from '@inquirer/prompts';
import { detectProject } from '../detector/project.js';
import { hasUnresolvedXcodeMacro } from '../detector/ios.js';
import { findAllConfigFiles } from '../config/loader.js';
import { getDefaultScripts } from '../config/defaults.js';
import { safeWriteFile, readFileUtf8 } from '../utils/fs.js';
import { formatUnifiedDiff, generateDiff } from '../utils/diff.js';
import { logger } from '../utils/logger.js';
import type {
  PackageManager,
  AndroidArtifact,
  AndroidTrack,
  IOSExportMethod,
  ReleaseKitUserConfig,
} from '../config/schema.js';

export interface InitCommandOptions {
  cwd?: string;
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  format?: 'ts' | 'js' | 'json';
}

export function generateConfigFileContent(
  config: ReleaseKitUserConfig,
  format: 'ts' | 'js' | 'json' = 'ts',
): string {
  if (format === 'json') {
    return JSON.stringify(config, null, 2) + '\n';
  }

  const jsConfig = JSON.stringify(config, null, 2);
  if (format === 'js') {
    return `// @ts-check\nconst { defineConfig } = require('react-native-release-kit');\n\nmodule.exports = defineConfig(${jsConfig});\n`;
  }

  return `import { defineConfig } from 'react-native-release-kit';\n\nexport default defineConfig(${jsConfig});\n`;
}

export async function initCommand(options: InitCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const format = options.format ?? 'ts';
  const targetFileName = `react-native-release.config.${format}`;
  const targetFilePath = path.resolve(cwd, targetFileName);

  logger.info(pc.bold('Initializing react-native-release-kit configuration...'));

  // Detect project environment
  const detected = await detectProject(cwd);
  if (!detected.isReactNative) {
    logger.warn('No "react-native" dependency was detected in package.json.');
    logger.warn('Continuing anyway, but standard CLI paths might differ.');
  }

  const hasMacroInDetectedBundleId = Boolean(
    detected.ios.hasUnresolvedBundleIdMacro ||
    (detected.ios.bundleId && hasUnresolvedXcodeMacro(detected.ios.bundleId)),
  );
  const reliableDetectedBundleId =
    detected.ios.bundleId && !hasMacroInDetectedBundleId ? detected.ios.bundleId : undefined;

  if (detected.ios.hasIOS && detected.ios.bundleId) {
    if (hasMacroInDetectedBundleId) {
      logger.warn(
        `Detected iOS bundle identifier "${detected.ios.bundleId}" contains an unresolved Xcode macro. Omitted "ios.bundleId" from ${targetFileName}. Specify a concrete reverse-DNS bundle identifier in ${targetFileName} before production iOS release.`,
      );
    } else if (detected.ios.isPlaceholderBundleId) {
      logger.warn(
        `Detected iOS bundle identifier "${detected.ios.bundleId}" is a placeholder. Update "ios.bundleId" in ${targetFileName} before production iOS release.`,
      );
    }
  }

  // Check if any existing config file exists
  const existingConfigs = findAllConfigFiles(cwd);
  const primaryExisting = existingConfigs[0] || null;

  if (primaryExisting && !options.force && !options.dryRun) {
    if (options.yes) {
      logger.error(
        `Configuration file already exists at ${primaryExisting}. Use --force to overwrite.`,
      );
      return 1;
    }
    const configNames = existingConfigs.map((f) => path.basename(f)).join(', ');
    const shouldOverwrite = await confirm({
      message: `Configuration file already exists (${configNames}). Overwrite?`,
      default: false,
    });
    if (!shouldOverwrite) {
      logger.info('Initialization aborted by user.');
      return 0;
    }
  }

  let finalConfig: ReleaseKitUserConfig;

  if (options.yes) {
    // Non-interactive automatic setup
    finalConfig = {
      projectName: detected.projectName,
      packageManager: detected.packageManager.manager,
      projectRoot: '.',
      scripts: getDefaultScripts(detected.packageManager.manager, detected.scripts),
      android: {
        enabled: detected.android.hasAndroid,
        ...(detected.android.appModule && detected.android.appModule !== 'app'
          ? { appModule: detected.android.appModule }
          : {}),
        buildArtifact: 'aab',
        buildTask: 'bundleRelease',
        deploymentTrack: 'internal',
        applicationId: detected.android.applicationId,
        packagePath: 'android',
      },
      ios: {
        enabled: detected.ios.hasIOS,
        buildArtifact: 'ipa',
        scheme: detected.ios.schemes[0] || detected.projectName,
        ...(reliableDetectedBundleId ? { bundleId: reliableDetectedBundleId } : {}),
        exportMethod: 'app-store',
        packagePath: 'ios',
      },
      githubActions: {
        enabled: true,
        triggers: {
          pullRequest: true,
          main: true,
          releaseTags: true,
        },
        cacheDependencies: true,
        runner: {
          android: 'ubuntu-latest',
          ios: 'macos-14',
        },
        nodeVersion: '20',
        javaVersion: '17',
        rubyVersion: '3.3',
      },
      signing: {
        android: {
          keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
          keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
          keyAliasSecretName: 'ANDROID_KEY_ALIAS',
          keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
        },
        ios: {
          appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
          appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
          appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
        },
      },
    };
  } else {
    // Interactive questionnaire
    const projectName = await input({
      message: 'Project name:',
      default: detected.projectName,
    });

    const packageManager = await select<PackageManager>({
      message: 'Package manager:',
      choices: [
        { name: 'npm', value: 'npm' },
        { name: 'yarn', value: 'yarn' },
        { name: 'pnpm', value: 'pnpm' },
        { name: 'bun', value: 'bun' },
      ],
      default: detected.packageManager.manager,
    });

    const enableAndroid = await confirm({
      message: 'Enable Android builds & release?',
      default: detected.android.hasAndroid,
    });

    let androidConfig = {
      enabled: false,
      buildArtifact: 'aab' as AndroidArtifact,
      buildTask: 'bundleRelease',
      deploymentTrack: 'internal' as AndroidTrack,
      applicationId: detected.android.applicationId,
      packagePath: 'android',
    };

    if (enableAndroid) {
      const buildArtifact = await select<AndroidArtifact>({
        message: 'Android release artifact:',
        choices: [
          { name: 'Android App Bundle (.aab) - Recommended for Google Play', value: 'aab' },
          { name: 'APK (.apk)', value: 'apk' },
        ],
        default: 'aab',
      });

      const deploymentTrack = await select<AndroidTrack>({
        message: 'Google Play default track:',
        choices: [
          { name: 'internal', value: 'internal' },
          { name: 'alpha', value: 'alpha' },
          { name: 'beta', value: 'beta' },
          { name: 'production', value: 'production' },
        ],
        default: 'internal',
      });

      const appId = await input({
        message: 'Android application ID:',
        default: detected.android.applicationId || 'com.example.app',
      });

      androidConfig = {
        enabled: true,
        ...(detected.android.appModule && detected.android.appModule !== 'app'
          ? { appModule: detected.android.appModule }
          : {}),
        buildArtifact,
        buildTask: buildArtifact === 'aab' ? 'bundleRelease' : 'assembleRelease',
        deploymentTrack,
        applicationId: appId,
        packagePath: 'android',
      };
    }

    const enableIOS = await confirm({
      message: 'Enable iOS builds & release?',
      default: detected.ios.hasIOS,
    });

    let iosConfig: ReleaseKitUserConfig['ios'] = {
      enabled: false,
      buildArtifact: 'ipa' as const,
      scheme: detected.ios.schemes[0] || projectName,
      ...(reliableDetectedBundleId ? { bundleId: reliableDetectedBundleId } : {}),
      exportMethod: 'app-store' as IOSExportMethod,
      packagePath: 'ios',
    };

    if (enableIOS) {
      const scheme = await input({
        message: 'Xcode Scheme:',
        default: detected.ios.schemes[0] || projectName,
      });

      const bundleId = await input({
        message: 'iOS Bundle Identifier (reverse-DNS, e.g. com.company.app):',
        ...(reliableDetectedBundleId ? { default: reliableDetectedBundleId } : {}),
      });

      const trimmedBundleId = bundleId.trim();
      let finalInteractiveBundleId: string | undefined = undefined;
      if (trimmedBundleId) {
        if (hasUnresolvedXcodeMacro(trimmedBundleId)) {
          logger.warn(
            `Entered iOS bundle identifier "${trimmedBundleId}" contains an unresolved Xcode macro and was omitted from the configuration.`,
          );
        } else {
          finalInteractiveBundleId = trimmedBundleId;
        }
      }

      const exportMethod = await select<IOSExportMethod>({
        message: 'iOS export method:',
        choices: [
          { name: 'app-store (TestFlight & App Store)', value: 'app-store' },
          { name: 'ad-hoc', value: 'ad-hoc' },
          { name: 'enterprise', value: 'enterprise' },
          { name: 'development', value: 'development' },
        ],
        default: 'app-store',
      });

      iosConfig = {
        enabled: true,
        buildArtifact: 'ipa',
        scheme,
        ...(finalInteractiveBundleId ? { bundleId: finalInteractiveBundleId } : {}),
        exportMethod,
        packagePath: 'ios',
      };
    }

    finalConfig = {
      projectName,
      packageManager,
      projectRoot: '.',
      scripts: getDefaultScripts(packageManager, detected.scripts),
      android: androidConfig,
      ios: iosConfig,
      githubActions: {
        enabled: true,
        triggers: {
          pullRequest: true,
          main: true,
          releaseTags: true,
        },
        cacheDependencies: true,
        runner: {
          android: 'ubuntu-latest',
          ios: 'macos-14',
        },
        nodeVersion: '20',
        javaVersion: '17',
        rubyVersion: '3.3',
      },
      signing: {
        android: {
          keystoreSecretName: 'ANDROID_KEYSTORE_BASE64',
          keystorePasswordSecretName: 'ANDROID_KEYSTORE_PASSWORD',
          keyAliasSecretName: 'ANDROID_KEY_ALIAS',
          keyPasswordSecretName: 'ANDROID_KEY_PASSWORD',
        },
        ios: {
          appStoreConnectKeyContentSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_CONTENT',
          appStoreConnectKeyIdSecretName: 'APP_STORE_CONNECT_API_KEY_KEY_ID',
          appStoreConnectIssuerIdSecretName: 'APP_STORE_CONNECT_API_KEY_ISSUER_ID',
        },
      },
    };
  }

  const content = generateConfigFileContent(finalConfig, format);

  if (options.dryRun) {
    logger.info(pc.bold(pc.yellow(`[DRY RUN] Preview of ${targetFileName}:`)));
    if (primaryExisting && existsSync(primaryExisting)) {
      const oldContent = await readFileUtf8(primaryExisting);
      const diff = generateDiff(targetFilePath, oldContent, content);
      logger.raw(formatUnifiedDiff(diff));
    } else {
      logger.raw(content);
    }
    logger.success('Dry run completed without writing files.');
    return 0;
  }

  // If overwriting and a different previous config file exists, remove obsolete files
  if (primaryExisting && (options.force || existingConfigs.length > 0)) {
    for (const oldConfig of existingConfigs) {
      if (oldConfig !== targetFilePath && existsSync(oldConfig)) {
        await fs.unlink(oldConfig);
      }
    }
  }

  const writeResult = await safeWriteFile(targetFilePath, content, {
    overwrite: options.force || Boolean(primaryExisting),
    dryRun: false,
  });

  if (writeResult.written) {
    logger.success(`Configuration created successfully at ${pc.cyan(targetFileName)}`);
    logger.info(`Next steps:`);
    logger.raw(`  1. Review your settings in ${pc.cyan(targetFileName)}`);
    logger.raw(`  2. Check prerequisites with: ${pc.cyan('npx react-native-release-kit doctor')}`);
    logger.raw(
      `  3. Generate workflows with: ${pc.cyan('npx react-native-release-kit setup --provider github-actions')}\n`,
    );
    return 0;
  }

  logger.error(`Could not write configuration file to ${targetFilePath}`);
  return 1;
}
