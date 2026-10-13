import { execa, type Options as ExecaOptions, type ResultPromise } from 'execa';
import { logger } from './logger.js';

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
    const result = await (execa(file, args, execaOpts) as unknown as ResultPromise);
    return {
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      exitCode: Number(result.exitCode ?? 0),
      command: fullCommand,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
    return {
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || e.message || 'Execution failed'),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : 1,
      command: fullCommand,
    };
  }
}
