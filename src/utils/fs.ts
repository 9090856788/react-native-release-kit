import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';

export async function fileExists(filePath: string): Promise<boolean> {
  return existsSync(filePath);
}

export async function readFileUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export interface WriteFileOptions {
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface WriteFileResult {
  written: boolean;
  existed: boolean;
  path: string;
  diff?: string;
}

export async function safeWriteFile(
  targetPath: string,
  content: string,
  options: WriteFileOptions = {},
): Promise<WriteFileResult> {
  const existed = existsSync(targetPath);
  let diff: string | undefined;

  if (existed) {
    const oldContent = await fs.readFile(targetPath, 'utf-8');
    diff = createTwoFilesPatch(targetPath, targetPath, oldContent, content, 'current', 'generated');

    if (!options.overwrite && !options.dryRun) {
      return {
        written: false,
        existed: true,
        path: targetPath,
        diff,
      };
    }
  } else {
    diff = createTwoFilesPatch('/dev/null', targetPath, '', content, 'empty', 'generated');
  }

  if (options.dryRun) {
    return {
      written: false,
      existed,
      path: targetPath,
      diff,
    };
  }

  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, 'utf-8');

  return {
    written: true,
    existed,
    path: targetPath,
    diff,
  };
}
