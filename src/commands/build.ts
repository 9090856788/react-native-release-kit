import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';

export interface BuildCommandOptions {
  platform: 'android' | 'ios';
  artifact?: 'aab' | 'apk' | 'ipa';
  cwd?: string;
}

export async function buildCommand(options: BuildCommandOptions): Promise<number> {
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

  if (platform === 'ios' && process.platform !== 'darwin') {
    logger.error('iOS builds can only be executed on macOS machines with Xcode.');
    return 1;
  }

  logger.info(`Building release artifact for platform: ${pc.cyan(platform)}...`);
  logger.info(`Target project: ${pc.bold(configResult.config.projectName)}`);
  logger.info(
    `Phase 1 registered interface. Native execution will be activated in Phase 3 (Android) and Phase 4 (iOS).`,
  );

  return 0;
}
