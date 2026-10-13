import path from 'node:path';
import { existsSync } from 'node:fs';
import type { PackageManager } from '../config/schema.js';
import type { PackageManagerDetection } from './types.js';

interface LockfileMapping {
  file: string;
  manager: PackageManager;
}

const LOCKFILE_DEFINITIONS: LockfileMapping[] = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
];

function checkYarnBerry(projectDir: string): boolean {
  let currentDir = projectDir;
  while (true) {
    if (
      existsSync(path.resolve(currentDir, '.yarnrc.yml')) ||
      existsSync(path.resolve(currentDir, '.yarnrc.yaml')) ||
      existsSync(path.resolve(currentDir, '.yarn/releases'))
    ) {
      return true;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return false;
}

export function getFrozenInstallCommand(manager: PackageManager, isYarnBerry = false): string {
  switch (manager) {
    case 'npm':
      return 'npm ci';
    case 'yarn':
      return isYarnBerry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
  }
}

export function detectPackageManager(projectDir: string = process.cwd()): PackageManagerDetection {
  // Find all lockfiles present in project directory
  const localFound: Array<{ file: string; manager: PackageManager }> = [];
  for (const item of LOCKFILE_DEFINITIONS) {
    const fullPath = path.resolve(projectDir, item.file);
    if (existsSync(fullPath)) {
      localFound.push(item);
    }
  }

  // If none found locally, check parent directories for monorepos
  let candidateFound = localFound;
  if (candidateFound.length === 0) {
    let currentDir = projectDir;
    while (true) {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
      for (const item of LOCKFILE_DEFINITIONS) {
        const parentLock = path.resolve(currentDir, item.file);
        if (existsSync(parentLock)) {
          candidateFound.push(item);
        }
      }
      if (candidateFound.length > 0) {
        break;
      }
    }
  }

  // Determine unique managers detected
  const uniqueManagers = Array.from(new Set(candidateFound.map((item) => item.manager)));
  const uniqueLockfiles = candidateFound.map((item) => item.file);

  if (uniqueManagers.length > 1) {
    // Conflicting lockfiles found!
    const primary = uniqueManagers[0]!;
    const isYarnBerry = primary === 'yarn' ? checkYarnBerry(projectDir) : false;
    return {
      manager: primary,
      lockfile: candidateFound[0]?.file || null,
      ambiguous: true,
      conflictingManagers: uniqueManagers,
      conflictingLockfiles: uniqueLockfiles,
      isYarnBerry,
      installCommand: primary === 'npm' ? 'npm install' : `${primary} install`,
      frozenInstallCommand: getFrozenInstallCommand(primary, isYarnBerry),
    };
  }

  if (uniqueManagers.length === 1) {
    const manager = uniqueManagers[0]!;
    const isYarnBerry = manager === 'yarn' ? checkYarnBerry(projectDir) : false;
    return {
      manager,
      lockfile: candidateFound[0]?.file || null,
      ambiguous: false,
      conflictingManagers: undefined,
      conflictingLockfiles: undefined,
      isYarnBerry,
      installCommand: manager === 'npm' ? 'npm install' : `${manager} install`,
      frozenInstallCommand: getFrozenInstallCommand(manager, isYarnBerry),
    };
  }

  // Default to npm when no lockfile exists
  return {
    manager: 'npm',
    lockfile: null,
    ambiguous: false,
    conflictingManagers: undefined,
    conflictingLockfiles: undefined,
    isYarnBerry: false,
    installCommand: 'npm install',
    frozenInstallCommand: 'npm ci',
  };
}
