import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';

export interface DeployCommandOptions {
  platform: 'android' | 'ios';
  track?: string;
  cwd?: string;
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
    logger.info(`Run ${pc.cyan('npx react-native-release-kit init')} first.`);
    return 1;
  }

  logger.info(`Deploying release for platform: ${pc.cyan(platform)}...`);
  logger.info(`Target project: ${pc.bold(configResult.config.projectName)}`);
  logger.info(`Phase 1 registered interface. Store publishing adapters activate in Phase 3 & 4.`);

  return 0;
}
