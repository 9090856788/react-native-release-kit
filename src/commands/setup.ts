import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { detectProject } from '../detector/project.js';
import { generateGitHubWorkflows } from '../generators/github-actions.js';
import { safeWriteFile, readFileUtf8 } from '../utils/fs.js';
import { generateDiff, formatUnifiedDiff } from '../utils/diff.js';
import { logger } from '../utils/logger.js';

export interface SetupCommandOptions {
  provider?: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  cwd?: string;
}

export async function setupCommand(options: SetupCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const provider = options.provider || 'github-actions';

  logger.info(pc.bold(`Configuring CI/CD workflows for provider: ${pc.cyan(provider)}...`));

  if (provider !== 'github-actions') {
    logger.error(`Unsupported provider "${provider}". Currently supported: github-actions.`);
    return 1;
  }

  const configResult = await loadConfig(cwd);
  if (!configResult.config) {
    logger.error('No valid react-native-release.config.ts found.');
    logger.info(
      `Run ${pc.cyan('npx react-native-release-kit init')} first to generate your configuration.`,
    );
    return 1;
  }

  const project = await detectProject(cwd);
  const config = configResult.config;

  logger.info(`Target project: ${pc.bold(config.projectName)}`);
  logger.info(`Package manager: ${pc.cyan(config.packageManager)}`);

  const { workflows, warnings } = await generateGitHubWorkflows(config, project, { cwd });

  for (const warning of warnings) {
    logger.warn(warning);
  }

  if (workflows.length === 0) {
    logger.warn('All workflows are disabled in configuration. Nothing to generate.');
    return 0;
  }

  // Handle --diff mode: preview unified diff without modifying files
  if (options.diff) {
    logger.info(pc.bold(pc.cyan('\nDisplaying proposed workflow diffs:')));
    for (const wf of workflows) {
      if (existsSync(wf.absolutePath)) {
        const existing = await readFileUtf8(wf.absolutePath);
        if (existing === wf.content) {
          logger.info(`  ${pc.dim('[identical]')} ${wf.relativePath}`);
        } else {
          logger.raw(
            '\n' + pc.bold(pc.yellow(`--- ${wf.relativePath} (diff against current) ---`)),
          );
          const patch = generateDiff(wf.relativePath, existing, wf.content);
          logger.raw(formatUnifiedDiff(patch));
        }
      } else {
        logger.raw('\n' + pc.bold(pc.green(`--- ${wf.relativePath} (new file) ---`)));
        const patch = generateDiff(wf.relativePath, '', wf.content);
        logger.raw(formatUnifiedDiff(patch));
      }
    }
    logger.info(pc.bold('\nDiff inspection completed without modifying any files.'));
    return 0;
  }

  // Handle --dry-run mode: display full generated output without modifying files
  if (options.dryRun) {
    logger.info(pc.bold(pc.yellow('\n[DRY RUN] Previewing generated workflow contents:')));
    for (const wf of workflows) {
      logger.raw('\n' + pc.bold(pc.cyan(`================ ${wf.relativePath} ================`)));
      logger.raw(wf.content);
    }
    logger.success('\nDry run completed without creating or modifying files.');
    return 0;
  }

  // Safety pre-flight check: never overwrite existing files without --force
  const conflictingFiles: string[] = [];
  for (const wf of workflows) {
    if (existsSync(wf.absolutePath)) {
      const existing = await readFileUtf8(wf.absolutePath);
      if (existing !== wf.content) {
        conflictingFiles.push(wf.relativePath);
      }
    }
  }

  if (conflictingFiles.length > 0 && !options.force) {
    logger.error('The following workflow file(s) already exist and differ from proposed output:');
    for (const file of conflictingFiles) {
      logger.error(`  - ${file}`);
    }
    logger.info(
      `Use ${pc.cyan('--force')} to overwrite existing files, or ${pc.cyan('--diff')} to review changes.`,
    );
    return 1;
  }

  // Atomic file write execution
  logger.info('\nWriting workflow files:');
  for (const wf of workflows) {
    const existed = existsSync(wf.absolutePath);
    if (existed) {
      const current = await readFileUtf8(wf.absolutePath);
      if (current === wf.content) {
        logger.info(`  ${pc.dim('[unchanged]')} ${wf.relativePath}`);
        continue;
      }
    }

    await safeWriteFile(wf.absolutePath, wf.content, { overwrite: true });
    if (existed) {
      logger.success(`  ${pc.yellow('[updated]')} ${wf.relativePath}`);
    } else {
      logger.success(`  ${pc.green('[created]')} ${wf.relativePath}`);
    }
  }

  logger.success('\nGitHub Actions workflows generated successfully!');
  logger.info('Next steps:');
  logger.raw('  1. Review generated workflows in .github/workflows/');
  logger.raw('  2. Commit and push the workflow files to your repository');
  logger.raw(`  3. Check prerequisites with: ${pc.cyan('npx react-native-release-kit doctor')}\n`);

  return 0;
}
