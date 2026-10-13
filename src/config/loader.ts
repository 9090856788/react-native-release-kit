import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import {
  ReleaseKitConfigSchema,
  type ReleaseKitConfig,
  type ReleaseKitUserConfig,
} from './schema.js';
import { readJsonFile } from '../utils/fs.js';

export const CONFIG_FILE_NAMES = [
  'react-native-release.config.ts',
  'react-native-release.config.js',
  'react-native-release.config.mjs',
  'react-native-release.config.cjs',
  'react-native-release.config.json',
];

export interface LoadedConfigResult {
  config: ReleaseKitConfig | null;
  configPath: string | null;
  error?: string;
  warnings?: string[];
  allFoundConfigs?: string[];
}

export function defineConfig(config: ReleaseKitUserConfig): ReleaseKitUserConfig {
  return config;
}

export function findAllConfigFiles(cwd: string = process.cwd()): string[] {
  const found: string[] = [];
  for (const name of CONFIG_FILE_NAMES) {
    const fullPath = path.resolve(cwd, name);
    if (existsSync(fullPath)) {
      found.push(fullPath);
    }
  }
  return found;
}

export function findConfigFile(cwd: string = process.cwd()): string | null {
  const all = findAllConfigFiles(cwd);
  return all.length > 0 ? all[0]! : null;
}

function resolvePackageEntryPath(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(currentDir, '../index.ts'),
      path.resolve(currentDir, '../index.js'),
      path.resolve(currentDir, '../../dist/index.js'),
      path.resolve(currentDir, '../../dist/index.cjs'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfigResult> {
  const allConfigs = findAllConfigFiles(cwd);
  if (allConfigs.length === 0) {
    return {
      config: null,
      configPath: null,
    };
  }

  const configPath = allConfigs[0]!;
  const warnings: string[] = [];

  if (allConfigs.length > 1) {
    const fileNames = allConfigs.map((f) => path.basename(f)).join(', ');
    const chosenName = path.basename(configPath);
    warnings.push(
      `Multiple configuration files found: [${fileNames}]. Using primary configuration "${chosenName}" based on precedence (.ts > .js > .mjs > .cjs > .json).`,
    );
  }

  try {
    let rawConfig: unknown;

    if (configPath.endsWith('.json')) {
      rawConfig = await readJsonFile(configPath);
    } else {
      const packageEntry = resolvePackageEntryPath();
      const jiti = createJiti(cwd, {
        interopDefault: true,
        alias: packageEntry ? { 'react-native-release-kit': packageEntry } : {},
      });
      const imported = await jiti.import(configPath);
      // Handle both default export and named export
      rawConfig = (imported as { default?: unknown }).default ?? imported;
    }

    if (!rawConfig || typeof rawConfig !== 'object') {
      return {
        config: null,
        configPath,
        error: `Configuration file at ${configPath} did not export an object.`,
        warnings: warnings.length > 0 ? warnings : undefined,
        allFoundConfigs: allConfigs,
      };
    }

    const validated = ReleaseKitConfigSchema.parse(rawConfig);
    return {
      config: validated,
      configPath,
      warnings: warnings.length > 0 ? warnings : undefined,
      allFoundConfigs: allConfigs,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      config: null,
      configPath,
      error: `Failed to load or validate configuration from ${configPath}:\n${message}`,
      warnings: warnings.length > 0 ? warnings : undefined,
      allFoundConfigs: allConfigs,
    };
  }
}
