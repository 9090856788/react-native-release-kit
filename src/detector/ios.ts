import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFileUtf8 } from '../utils/fs.js';
import type { IOSDetection } from './types.js';

export interface DetectIOSOptions {
  packagePath?: string;
}

const XCODE_MACRO_REGEX = /\$(\([^)]*\)|\{[^}]*\})/;

export function hasUnresolvedXcodeMacro(value: string): boolean {
  return XCODE_MACRO_REGEX.test(value.trim());
}

export function isPlaceholderIOSBundleId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (hasUnresolvedXcodeMacro(trimmed)) return true;
  if (/^org\.reactjs\.native\.example(\.|$)/i.test(trimmed)) return true;
  if (/^com\.example(\.|$)/i.test(trimmed)) return true;
  return false;
}

function isTestTargetBundleId(bundleId: string): boolean {
  const cleaned = bundleId.trim();
  return /(?:Tests|UITests|\.tests|\.uitests)$/i.test(cleaned);
}

function isTestBuildSettingsBlock(block: string): boolean {
  if (/\b(?:TEST_HOST|BUNDLE_LOADER|TEST_TARGET_NAME)\s*=/.test(block)) {
    return true;
  }
  if (/\bWRAPPER_EXTENSION\s*=\s*["']?xctest["']?\s*;/.test(block)) {
    return true;
  }
  const productNameMatch = block.match(/\bPRODUCT_NAME\s*=\s*([^;]+);/);
  if (productNameMatch?.[1]) {
    const productName = productNameMatch[1].trim().replace(/^"(.*)"$/, '$1');
    if (/(?:Tests|UITests)$/i.test(productName)) {
      return true;
    }
  }
  return false;
}

function extractBuildSettingsBlocks(pbxprojContent: string): string[] {
  const blocks: string[] = [];
  const regex = /\bbuildSettings\s*=\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(pbxprojContent)) !== null) {
    const startIdx = match.index + match[0].length;
    let depth = 1;
    for (let i = startIdx; i < pbxprojContent.length; i++) {
      const ch = pbxprojContent[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(pbxprojContent.slice(startIdx, i));
          break;
        }
      }
    }
  }

  return blocks;
}

export function extractApplicationBundleIdFromPbxproj(pbxprojContent: string): string | undefined {
  const buildSettingsBlocks = extractBuildSettingsBlocks(pbxprojContent);
  const appCandidates: string[] = [];

  if (buildSettingsBlocks.length > 0) {
    for (const block of buildSettingsBlocks) {
      if (isTestBuildSettingsBlock(block)) {
        continue;
      }
      const match = block.match(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/);
      if (match?.[1]) {
        const cleaned = match[1].trim().replace(/^"(.*)"$/, '$1');
        if (cleaned && !isTestTargetBundleId(cleaned)) {
          appCandidates.push(cleaned);
        }
      }
    }
  }

  if (appCandidates.length === 0) {
    const allMatches = pbxprojContent.matchAll(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g);
    for (const m of allMatches) {
      if (m[1]) {
        const cleaned = m[1].trim().replace(/^"(.*)"$/, '$1');
        if (cleaned && !isTestTargetBundleId(cleaned)) {
          appCandidates.push(cleaned);
        }
      }
    }
  }

  if (appCandidates.length === 0) {
    return undefined;
  }

  // Prefer a concrete production bundle ID over an unresolved macro or placeholder if both exist (e.g. Release vs Debug)
  const concrete = appCandidates.find(
    (id) => !hasUnresolvedXcodeMacro(id) && !isPlaceholderIOSBundleId(id),
  );
  return concrete ?? appCandidates[0];
}

export async function detectIOS(
  projectDir: string = process.cwd(),
  options: DetectIOSOptions = {},
): Promise<IOSDetection> {
  const packagePath = options.packagePath || 'ios';
  const normalizedPkgPath = packagePath.replace(/\\/g, '/').replace(/\/+$/, '') || 'ios';
  const iosDir = path.resolve(projectDir, packagePath);

  if (!existsSync(iosDir)) {
    return {
      hasIOS: false,
      packagePath,
      hasPodfile: false,
      schemes: [],
    };
  }

  const podfilePath = path.resolve(iosDir, 'Podfile');
  const hasPodfile = existsSync(podfilePath);

  let workspace: string | undefined;
  let xcodeproj: string | undefined;
  const schemes: string[] = [];
  let bundleId: string | undefined;

  try {
    const entries = await fs.readdir(iosDir);

    // Look for .xcworkspace (prefer non-test workspace)
    const workspaces = entries.filter((e) => e.endsWith('.xcworkspace'));
    const primaryWorkspace =
      workspaces.find((e) => !/(?:Tests|UITests)\.xcworkspace$/i.test(e)) ?? workspaces[0];
    if (primaryWorkspace) {
      workspace = `${normalizedPkgPath}/${primaryWorkspace}`;
      const schemeName = primaryWorkspace.replace(/\.xcworkspace$/, '');
      if (!schemes.includes(schemeName)) {
        schemes.push(schemeName);
      }
    }

    // Look for .xcodeproj (prefer non-test project)
    const projects = entries.filter((e) => e.endsWith('.xcodeproj'));
    const primaryProject =
      projects.find((e) => !/(?:Tests|UITests)\.xcodeproj$/i.test(e)) ?? projects[0];
    if (primaryProject) {
      xcodeproj = `${normalizedPkgPath}/${primaryProject}`;
      if (schemes.length === 0) {
        const schemeName = primaryProject.replace(/\.xcodeproj$/, '');
        schemes.push(schemeName);
      }

      // Check shared schemes inside .xcodeproj/xcshareddata/xcschemes
      const sharedSchemesDir = path.resolve(iosDir, primaryProject, 'xcshareddata', 'xcschemes');
      if (existsSync(sharedSchemesDir)) {
        try {
          const schemeFiles = await fs.readdir(sharedSchemesDir);
          for (const file of schemeFiles) {
            if (file.endsWith('.xcscheme') && !/(?:Tests|UITests)\.xcscheme$/i.test(file)) {
              const name = file.replace(/\.xcscheme$/, '');
              if (name && !schemes.includes(name)) {
                schemes.push(name);
              }
            }
          }
        } catch {
          // Ignore unreadable xcschemes dir
        }
      }

      // Extract application target PRODUCT_BUNDLE_IDENTIFIER from project.pbxproj
      const pbxprojPath = path.resolve(iosDir, primaryProject, 'project.pbxproj');
      if (existsSync(pbxprojPath)) {
        const content = await readFileUtf8(pbxprojPath);
        bundleId = extractApplicationBundleIdFromPbxproj(content);
      }
    }
  } catch {
    // Directory unreadable or error
  }

  const hasMacro = bundleId ? hasUnresolvedXcodeMacro(bundleId) : false;
  const isPlaceholder = bundleId ? isPlaceholderIOSBundleId(bundleId) : false;

  return {
    hasIOS: true,
    packagePath,
    hasPodfile,
    workspace,
    xcodeproj,
    schemes,
    bundleId,
    hasUnresolvedBundleIdMacro: bundleId ? hasMacro : undefined,
    isPlaceholderBundleId: bundleId ? isPlaceholder : undefined,
  };
}
