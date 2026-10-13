import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFileUtf8 } from '../utils/fs.js';
import type { IOSDetection } from './types.js';

export async function detectIOS(projectDir: string = process.cwd()): Promise<IOSDetection> {
  const iosDir = path.resolve(projectDir, 'ios');
  if (!existsSync(iosDir)) {
    return {
      hasIOS: false,
      packagePath: 'ios',
      hasPodfile: false,
      schemes: [],
    };
  }

  const podfilePath = path.resolve(iosDir, 'Podfile');
  const hasPodfile = existsSync(podfilePath);

  let workspace: string | undefined;
  const schemes: string[] = [];
  let bundleId: string | undefined;

  try {
    const entries = await fs.readdir(iosDir);

    // Look for .xcworkspace
    const xcworkspace = entries.find((e) => e.endsWith('.xcworkspace'));
    if (xcworkspace) {
      workspace = path.join('ios', xcworkspace);
      const schemeName = xcworkspace.replace('.xcworkspace', '');
      schemes.push(schemeName);
    }

    // Look for .xcodeproj if no workspace found yet
    const xcodeproj = entries.find((e) => e.endsWith('.xcodeproj'));
    if (xcodeproj && schemes.length === 0) {
      const schemeName = xcodeproj.replace('.xcodeproj', '');
      schemes.push(schemeName);
    }

    // Attempt to extract PRODUCT_BUNDLE_IDENTIFIER from project.pbxproj
    if (xcodeproj) {
      const pbxprojPath = path.resolve(iosDir, xcodeproj, 'project.pbxproj');
      if (existsSync(pbxprojPath)) {
        const content = await readFileUtf8(pbxprojPath);
        const match = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/);
        if (match?.[1]) {
          bundleId = match[1].trim().replace(/^"(.*)"$/, '$1');
        }
      }
    }
  } catch {
    // Directory unreadable or error
  }

  return {
    hasIOS: true,
    packagePath: 'ios',
    hasPodfile,
    workspace,
    schemes,
    bundleId,
  };
}
