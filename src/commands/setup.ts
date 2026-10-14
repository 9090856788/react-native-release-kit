import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { loadConfig } from '../config/loader.js';
import { detectProject } from '../detector/project.js';
import { generateGitHubWorkflows } from '../generators/github-actions.js';
import { generateFastlaneFiles } from '../generators/fastlane.js';
import { safeWriteFile, readFileUtf8 } from '../utils/fs.js';
import { generateDiff, formatUnifiedDiff } from '../utils/diff.js';
import { logger } from '../utils/logger.js';

export interface SetupCommandOptions {
  provider?: string;
  fastlane?: boolean;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  cwd?: string;
}

interface ProposedFileItem {
  type: 'workflow' | 'fastlane';
  relativePath: string;
  absolutePath: string;
  content: string;
}

export async function setupCommand(options: SetupCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const isFastlane = Boolean(options.fastlane);
  const provider = options.provider || (isFastlane ? 'none' : 'github-actions');

  if (provider !== 'github-actions' && provider !== 'none') {
    logger.error(`Unsupported provider "${provider}". Currently supported: github-actions.`);
    return 1;
  }

  const configResult = await loadConfig(cwd);
  if (!configResult.config) {
    logger.error('No valid react-native-release.config.ts found.');
    if (configResult.error) {
      logger.error(configResult.error);
    }
    logger.info(
      `Run ${pc.cyan('npx react-native-release-kit init')} first to generate your configuration.`,
    );
    return 1;
  }

  const config = configResult.config;
  const project = await detectProject(cwd, {
    androidPackagePath: config.android.packagePath,
    androidAppModule: config.android.appModule,
    iosPackagePath: config.ios.packagePath,
  });

  logger.info(`Target project: ${pc.bold(config.projectName)}`);
  logger.info(`Package manager: ${pc.cyan(config.packageManager)}`);

  const proposedFiles: ProposedFileItem[] = [];

  // 1. Process GitHub Actions workflows
  if (provider === 'github-actions') {
    logger.info(pc.bold(`Configuring CI/CD workflows for provider: ${pc.cyan(provider)}...`));
    const { workflows, warnings } = await generateGitHubWorkflows(config, project, { cwd });

    for (const warning of warnings) {
      logger.warn(warning);
    }

    for (const wf of workflows) {
      proposedFiles.push({
        type: 'workflow',
        relativePath: wf.relativePath,
        absolutePath: wf.absolutePath,
        content: wf.content,
      });
    }
  }

  // 2. Process Fastlane deployment files
  if (isFastlane) {
    logger.info(pc.bold('Configuring Fastlane deployment lanes...'));
    const fastlaneResults = await generateFastlaneFiles(config, { cwd, project });

    if (fastlaneResults.length === 0) {
      logger.warn(
        'Neither Android nor iOS is enabled in configuration. No Fastlane files to generate.',
      );
    }

    for (const fl of fastlaneResults) {
      proposedFiles.push({
        type: 'fastlane',
        relativePath: fl.relativePath,
        absolutePath: fl.filePath,
        content: fl.content,
      });
    }
  }

  if (proposedFiles.length === 0) {
    logger.warn('All workflows and configurations are disabled or empty. Nothing to generate.');
    return 0;
  }

  // Handle --diff mode: preview unified diff without modifying files
  if (options.diff) {
    logger.info(pc.bold(pc.cyan('\nDisplaying proposed file diffs:')));
    for (const file of proposedFiles) {
      if (existsSync(file.absolutePath)) {
        const existing = await readFileUtf8(file.absolutePath);
        if (existing === file.content) {
          logger.info(`  ${pc.dim('[identical]')} ${file.relativePath}`);
        } else {
          logger.raw(
            '\n' + pc.bold(pc.yellow(`--- ${file.relativePath} (diff against current) ---`)),
          );
          const patch = generateDiff(file.relativePath, existing, file.content);
          logger.raw(formatUnifiedDiff(patch));
        }
      } else {
        logger.raw('\n' + pc.bold(pc.green(`--- ${file.relativePath} (new file) ---`)));
        const patch = generateDiff(file.relativePath, '', file.content);
        logger.raw(formatUnifiedDiff(patch));
      }
    }
    logger.info(pc.bold('\nDiff inspection completed without modifying any files.'));
    return 0;
  }

  // Handle --dry-run mode: display full generated output without modifying files
  if (options.dryRun) {
    logger.info(pc.bold(pc.yellow('\n[DRY RUN] Previewing generated file contents:')));
    for (const file of proposedFiles) {
      logger.raw('\n' + pc.bold(pc.cyan(`================ ${file.relativePath} ================`)));
      logger.raw(file.content);
    }
    logger.success('\nDry run completed without creating or modifying files.');
    return 0;
  }

  // Safety pre-flight check: never overwrite existing files without --force
  const conflictingFiles: string[] = [];
  for (const file of proposedFiles) {
    if (existsSync(file.absolutePath)) {
      const existing = await readFileUtf8(file.absolutePath);
      if (existing !== file.content) {
        conflictingFiles.push(file.relativePath);
      }
    }
  }

  if (conflictingFiles.length > 0 && !options.force) {
    logger.error('The following file(s) already exist and differ from proposed output:');
    for (const file of conflictingFiles) {
      logger.error(`  - ${file}`);
    }
    logger.info(
      `Use ${pc.cyan('--force')} to overwrite existing files, or ${pc.cyan('--diff')} to review changes.`,
    );
    return 1;
  }

  // Atomic file write execution
  logger.info('\nWriting configuration files:');
  for (const file of proposedFiles) {
    const existed = existsSync(file.absolutePath);
    if (existed) {
      const current = await readFileUtf8(file.absolutePath);
      if (current === file.content) {
        logger.info(`  ${pc.dim('[unchanged]')} ${file.relativePath}`);
        continue;
      }
    }

    await safeWriteFile(file.absolutePath, file.content, { overwrite: true });
    if (existed) {
      logger.success(`  ${pc.yellow('[updated]')} ${file.relativePath}`);
    } else {
      logger.success(`  ${pc.green('[created]')} ${file.relativePath}`);
    }
  }

  const generatedWorkflows = proposedFiles.some((f) => f.type === 'workflow');
  const generatedFastlane = proposedFiles.some((f) => f.type === 'fastlane');

  if (generatedWorkflows) {
    logger.success('\nGitHub Actions workflows generated successfully!');
    logger.info('Next steps:');
    logger.raw('  1. Review generated workflows in .github/workflows/');
    logger.raw('  2. Commit and push the workflow files to your repository');
    logger.raw(
      `  3. Check prerequisites with: ${pc.cyan('npx react-native-release-kit doctor')}\n`,
    );
  }

  if (generatedFastlane) {
    logger.success('\nFastlane configuration files generated successfully in fastlane/!');
    logger.info(
      'Notice: Fastlane deployment lanes are configured to read credentials from environment variables (e.g. SUPPLY_JSON_KEY, APP_STORE_CONNECT_API_KEY_KEY_CONTENT). Store credentials and signing certificates are NOT configured yet. Ensure required secrets are set up before running deployment lanes.\n',
    );
  }

  return 0;
}
