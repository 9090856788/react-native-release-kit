import { execa, type Options as ExecaOptions } from 'execa';
import { logger, maskSecrets } from './logger.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface SafeExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  silent?: boolean;
}

export async function safeExec(
  file: string,
  args: string[] = [],
  options: SafeExecOptions = {},
): Promise<ExecResult> {
  const fullCommand = `${file} ${args.join(' ')}`;
  if (!options.silent) {
    logger.debug(`Executing command: ${fullCommand}`);
  }

  const execaOpts: ExecaOptions = {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    reject: false,
  };

  try {
    const result = await execa(file, args, execaOpts);
    const isFailed = Boolean(result.failed);
    const resolvedExitCode =
      typeof result.exitCode === 'number' ? result.exitCode : isFailed ? 1 : 0;
    const resolvedStderr = String(
      result.stderr || (isFailed ? result.shortMessage || result.message || '' : ''),
    );
    return {
      stdout: maskSecrets(String(result.stdout || '')),
      stderr: maskSecrets(resolvedStderr),
      exitCode: resolvedExitCode,
      command: maskSecrets(fullCommand),
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
    return {
      stdout: maskSecrets(String(e.stdout || '')),
      stderr: maskSecrets(String(e.stderr || e.message || 'Execution failed')),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : 1,
      command: maskSecrets(fullCommand),
    };
  }
}
