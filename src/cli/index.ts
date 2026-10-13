import { Command } from 'commander';
import pc from 'picocolors';
import { logger } from '../utils/logger.js';
import { initCommand } from '../commands/init.js';
import { doctorCommand } from '../commands/doctor.js';
import { setupCommand } from '../commands/setup.js';
import { buildCommand } from '../commands/build.js';
import { deployCommand } from '../commands/deploy.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('react-native-release-kit')
    .description('Opinionated, automated CI/CD and release toolkit for React Native CLI apps')
    .version('0.1.0', '-v, --version', 'Output the current release-kit version')
    .option('--verbose', 'Enable verbose debug output')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean }>();
      if (opts.verbose) {
        logger.setLevel('debug');
      }
    });

  // init command
  program
    .command('init')
    .description('Initialize react-native-release.config.ts in the current project')
    .option('-y, --yes', 'Accept defaults and skip interactive prompts', false)
    .option('--dry-run', 'Preview generated configuration without writing files', false)
    .option('--force', 'Overwrite existing configuration file without prompting', false)
    .option('--format <format>', 'Config format: ts, js, or json', 'ts')
    .action(async (options) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const exitCode = await initCommand({
        cwd: globalOpts.cwd,
        yes: options.yes,
        dryRun: options.dryRun,
        force: options.force,
        format: options.format as 'ts' | 'js' | 'json',
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });

  // doctor command
  program
    .command('doctor')
    .description('Verify prerequisites, SDKs, and project configuration')
    .option('--skip-android', 'Skip Android prerequisite checks', false)
    .option('--skip-ios', 'Skip iOS prerequisite checks', false)
    .option('--json', 'Output check results as raw JSON', false)
    .action(async (options) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const exitCode = await doctorCommand({
        cwd: globalOpts.cwd,
        skipAndroid: options.skipAndroid,
        skipIOS: options.skipIOS ?? options.skipIos,
        json: options.json,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });

  // setup command
  program
    .command('setup')
    .description('Generate CI/CD workflows and deployment configurations')
    .option(
      '-p, --provider <provider>',
      'CI/CD provider (default: github-actions)',
      'github-actions',
    )
    .option('--dry-run', 'Preview generated files without writing them', false)
    .option('--diff', 'Display diff against existing files', false)
    .option('--force', 'Overwrite existing workflow files without prompting', false)
    .action(async (options) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const exitCode = await setupCommand({
        cwd: globalOpts.cwd,
        provider: options.provider,
        dryRun: options.dryRun,
        diff: options.diff,
        force: options.force,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });

  // build command
  program
    .command('build')
    .description('Build release artifact for specified platform')
    .requiredOption('-p, --platform <platform>', 'Target platform: android or ios')
    .option('-a, --artifact <artifact>', 'Target artifact: aab, apk, or ipa')
    .action(async (options) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const exitCode = await buildCommand({
        cwd: globalOpts.cwd,
        platform: options.platform as 'android' | 'ios',
        artifact: options.artifact as 'aab' | 'apk' | 'ipa',
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });

  // deploy command
  program
    .command('deploy')
    .description('Publish release artifact to store tracks')
    .requiredOption('-p, --platform <platform>', 'Target platform: android or ios')
    .option('-t, --track <track>', 'Store deployment track (e.g. internal, alpha, testflight)')
    .action(async (options) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const exitCode = await deployCommand({
        cwd: globalOpts.cwd,
        platform: options.platform as 'android' | 'ios',
        track: options.track,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(pc.red(`Fatal CLI error: ${message}`));
    process.exit(1);
  }
}
