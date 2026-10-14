import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { PublisherAdapter } from '../adapters/publisher.js';
import type { AndroidReleaseStatus } from '../config/schema.js';
import { logger } from '../utils/logger.js';

export interface DeployCommandOptions {
  platform: 'android' | 'ios';
  track?: string;
  releaseStatus?: AndroidReleaseStatus;
  artifactPath?: string;
  appModule?: string;
  flavor?: string;
  confirmProduction?: boolean;
  dryRun?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function deployCommand(options: DeployCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform;

  if (!platform || (platform !== 'android' && platform !== 'ios')) {
    logger.error('Invalid or missing --platform option. Expected "android" or "ios".');
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

  const publisher = new PublisherAdapter(config);

  if (platform === 'ios') {
    logger.info(`Deploying release for platform: ${pc.cyan(platform)}...`);
    logger.info(`Target project: ${pc.bold(config.projectName)}`);
    const result = await publisher.publish({
      platform: 'ios',
      track: options.track || 'testflight',
      cwd,
      env: options.env,
    });
    logger.error(result.message);
    if (result.remediation) {
      logger.info(`${pc.bold('Remediation:')} ${result.remediation}`);
    }
    return 1;
  }

  const track = options.track ?? config.android.deploymentTrack ?? 'internal';
  logger.info(
    `Deploying Android release for ${pc.bold(config.projectName)} to Google Play "${pc.cyan(track)}" track...`,
  );

  const result = await publisher.publish({
    platform: 'android',
    track,
    releaseStatus: options.releaseStatus,
    artifactPath: options.artifactPath,
    appModule: options.appModule,
    flavor: options.flavor,
    confirmProduction: options.confirmProduction,
    dryRun: options.dryRun,
    cwd,
    env: options.env,
  });

  if (!result.success) {
    logger.error(result.message);
    if (result.remediation) {
      logger.info(`${pc.bold('Remediation:')} ${result.remediation}`);
    }
    return 1;
  }

  logger.success(result.message);
  if (result.artifactPath) {
    logger.info(`Artifact: ${pc.green(result.artifactPath)}`);
  }

  return 0;
}
