import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { AndroidAdapter } from '../adapters/android.js';
import { IOSAdapter } from '../adapters/ios.js';
import type { AndroidArtifact, AndroidVariant } from '../config/schema.js';
import { logger } from '../utils/logger.js';

export interface BuildCommandOptions {
  platform: 'android' | 'ios';
  variant?: AndroidVariant;
  artifact?: 'aab' | 'apk' | 'ipa';
  appModule?: string;
  flavor?: string;
  sign?: boolean;
  dryRun?: boolean;
  skipEnvCheck?: boolean;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function buildCommand(options: BuildCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform;

  if (!platform || (platform !== 'android' && platform !== 'ios')) {
    logger.error('Invalid or missing --platform option. Expected "android" or "ios".');
    return 1;
  }

  if (options.variant && options.variant !== 'debug' && options.variant !== 'release') {
    logger.error(`Invalid --variant "${options.variant}". Expected "debug" or "release".`);
    return 1;
  }

  const configResult = await loadConfig(cwd);
  if (!configResult.config) {
    logger.error('No valid react-native-release.config.ts found.');
    if (configResult.error) {
      logger.error(configResult.error);
    }
    logger.info(`Run ${pc.cyan('npx react-native-release-kit init')} first.`);
    return 1;
  }

  const config = configResult.config;

  if (platform === 'ios') {
    if (process.platform !== 'darwin') {
      logger.error('iOS builds can only be executed on macOS machines with Xcode.');
      return 1;
    }
    logger.info(`Building release artifact for platform: ${pc.cyan(platform)}...`);
    logger.info(`Target project: ${pc.bold(config.projectName)}`);
    const adapter = new IOSAdapter(config);
    const result = await adapter.build({ artifact: options.artifact === 'ipa' ? 'ipa' : 'app' });
    if (!result.success) {
      logger.error(result.error || 'Local native iOS build execution is not supported.');
      if (result.remediation) {
        logger.info(`${pc.bold('Remediation:')} ${result.remediation}`);
      }
      return 1;
    }
    return 0;
  }

  // Validate Android artifact type if explicitly provided
  if (options.artifact && options.artifact !== 'aab' && options.artifact !== 'apk') {
    logger.error(`Invalid Android --artifact "${options.artifact}". Expected "aab" or "apk".`);
    return 1;
  }

  const adapter = new AndroidAdapter(config);
  const variant: AndroidVariant = options.variant ?? config.android.buildVariant ?? 'release';
  const artifact: AndroidArtifact =
    options.artifact ?? (variant === 'debug' ? 'apk' : (config.android.buildArtifact ?? 'aab'));

  logger.info(
    `Building Android ${pc.bold(variant)} ${pc.cyan(artifact.toUpperCase())} for project: ${pc.bold(config.projectName)}...`,
  );

  const result = await adapter.build({
    cwd,
    variant,
    artifact,
    appModule: options.appModule,
    flavor: options.flavor,
    sign: options.sign,
    dryRun: options.dryRun,
    skipEnvCheck: options.skipEnvCheck,
    timeoutMs: options.timeoutMs,
    env: options.env,
  });

  if (!result.success) {
    logger.error(result.error || 'Android build failed.');
    if (result.remediation) {
      logger.info(`${pc.bold('Remediation:')} ${result.remediation}`);
    }
    return 1;
  }

  if (options.dryRun) {
    logger.success(
      `[DRY RUN] Validated Android build configuration. Resolved Gradle task: ${pc.cyan(result.gradleTask)}`,
    );
    return 0;
  }

  logger.success(
    `Android ${result.variant} ${result.artifactType.toUpperCase()} built successfully in ${(result.durationMs / 1000).toFixed(1)}s!`,
  );
  logger.info(`Gradle task: ${pc.cyan(result.gradleTask)}`);
  logger.info(`Artifact path: ${pc.green(result.artifactPath!)}`);

  return 0;
}
