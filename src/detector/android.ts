import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { readFileUtf8 } from '../utils/fs.js';
import type { AndroidDetection, AndroidSigningDetails } from './types.js';

export interface DetectAndroidOptions {
  packagePath?: string;
  appModule?: string;
}

function findModuleBuildGradle(androidDir: string, moduleName: string): string | null {
  const groovy = path.resolve(androidDir, moduleName, 'build.gradle');
  if (existsSync(groovy)) return groovy;
  const kts = path.resolve(androidDir, moduleName, 'build.gradle.kts');
  if (existsSync(kts)) return kts;
  return null;
}

async function discoverGradleModules(androidDir: string): Promise<string[]> {
  const modules = new Set<string>();

  // 1. Inspect settings.gradle or settings.gradle.kts
  const settingsFiles = ['settings.gradle', 'settings.gradle.kts'];
  for (const file of settingsFiles) {
    const settingsPath = path.resolve(androidDir, file);
    if (existsSync(settingsPath)) {
      try {
        const content = await readFileUtf8(settingsPath);
        // Match ':moduleName' or ":moduleName" inside include statements
        const matches = content.matchAll(/['"]:([a-zA-Z0-9_-]+)['"]/g);
        for (const m of matches) {
          if (m[1]) {
            modules.add(m[1]);
          }
        }
      } catch {
        // Ignore read error
      }
    }
  }

  // 2. Scan immediate subdirectories for build.gradle / build.gradle.kts
  try {
    const entries = readdirSync(androidDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'build' &&
        entry.name !== 'gradle' &&
        entry.name !== 'fastlane'
      ) {
        if (findModuleBuildGradle(androidDir, entry.name) !== null) {
          modules.add(entry.name);
        }
      }
    }
  } catch {
    // Ignore directory scan errors
  }

  return Array.from(modules);
}

function extractBalancedBlock(content: string, keyword: string): string | null {
  const regex = new RegExp(`\\b${keyword}\\s*\\{`);
  const match = regex.exec(content);
  if (!match) return null;

  const startIdx = match.index + match[0].length;
  let depth = 1;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(startIdx, i);
      }
    }
  }
  return null;
}

function parseFlavorsFromGradle(content: string): string[] {
  const flavors: string[] = [];
  const block = extractBalancedBlock(content, 'productFlavors');
  if (!block) return flavors;

  // Match Kotlin DSL `create("staging")`
  const ktsMatches = block.matchAll(/create\s*\(\s*["']([a-zA-Z0-9_-]+)["']\s*\)/g);
  for (const m of ktsMatches) {
    if (m[1]) flavors.push(m[1]);
  }

  if (flavors.length === 0) {
    const groovyMatches = block.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\{/gm);
    for (const m of groovyMatches) {
      const name = m[1];
      if (name && name !== 'dimension' && name !== 'matchingFallbacks') {
        flavors.push(name);
      }
    }
  }

  return Array.from(new Set(flavors));
}

export function parseSigningDetailsFromGradle(content: string): AndroidSigningDetails {
  let usesDebugSigningInRelease = false;
  let hasReleaseSigningConfig = false;
  let hasEnvBasedSigning = false;
  let hasPropertyBasedSigning = false;

  // 1. Inspect signingConfigs block
  const signingConfigsBlock = extractBalancedBlock(content, 'signingConfigs');
  if (signingConfigsBlock) {
    if (
      /\brelease\s*\{/.test(signingConfigsBlock) ||
      /\b(?:create|getByName|named)\s*\(\s*["']release["']\s*\)/.test(signingConfigsBlock) ||
      /\bval\s+release\s+by\s+registering\b/.test(signingConfigsBlock)
    ) {
      hasReleaseSigningConfig = true;
    }

    if (/\b(?:System\.getenv|ANDROID_KEYSTORE|MYAPP_UPLOAD)\b/.test(signingConfigsBlock)) {
      hasEnvBasedSigning = true;
    }

    if (
      /\b(?:findProperty|hasProperty|project\.property|MYAPP_UPLOAD_STORE_FILE|ANDROID_KEYSTORE_PATH)\b/.test(
        signingConfigsBlock,
      )
    ) {
      hasPropertyBasedSigning = true;
    }
  }

  // 2. Inspect buildTypes block
  const buildTypesBlock = extractBalancedBlock(content, 'buildTypes');
  if (buildTypesBlock) {
    let releaseBlock = extractBalancedBlock(buildTypesBlock, 'release');
    if (!releaseBlock) {
      const ktsMatch = /\b(?:getByName|named)\s*\(\s*["']release["']\s*\)\s*\{/.exec(
        buildTypesBlock,
      );
      if (ktsMatch) {
        const startIdx = ktsMatch.index + ktsMatch[0].length;
        let depth = 1;
        for (let i = startIdx; i < buildTypesBlock.length; i++) {
          if (buildTypesBlock[i] === '{') depth++;
          else if (buildTypesBlock[i] === '}') {
            depth--;
            if (depth === 0) {
              releaseBlock = buildTypesBlock.slice(startIdx, i);
              break;
            }
          }
        }
      }
    }

    if (releaseBlock) {
      if (
        /\bsigningConfig\s*(?:=|\s)\s*signingConfigs\.(?:debug\b|getByName\s*\(\s*["']debug["']\s*\)|\[\s*["']debug["']\s*\])/.test(
          releaseBlock,
        ) ||
        /\bsigningConfig\s+signingConfigs\.debug\b/.test(releaseBlock)
      ) {
        usesDebugSigningInRelease = true;
      }
    } else {
      if (
        /\brelease\s*\{[^}]*?\bsigningConfig\s*(?:=|\s)\s*signingConfigs\.(?:debug\b|getByName\s*\(\s*["']debug["']\s*\))/.test(
          buildTypesBlock,
        )
      ) {
        usesDebugSigningInRelease = true;
      }
    }
  } else {
    if (
      /\brelease\s*\{[^}]*?\bsigningConfig\s*(?:=|\s)\s*signingConfigs\.(?:debug\b|getByName\s*\(\s*["']debug["']\s*\))/.test(
        content,
      )
    ) {
      usesDebugSigningInRelease = true;
    }
  }

  return {
    usesDebugSigningInRelease,
    hasReleaseSigningConfig,
    hasEnvBasedSigning: hasEnvBasedSigning || content.includes('System.getenv("ANDROID_KEYSTORE'),
    hasPropertyBasedSigning,
  };
}

export async function detectAndroid(
  projectDir: string = process.cwd(),
  options: DetectAndroidOptions = {},
): Promise<AndroidDetection> {
  const packagePath = options.packagePath || 'android';
  const androidDir = path.resolve(projectDir, packagePath);

  if (!existsSync(androidDir)) {
    return {
      hasAndroid: false,
      packagePath,
      buildGradleFound: false,
      hasGradlew: false,
    };
  }

  const isWindows = process.platform === 'win32';
  const gradlewUnix = path.resolve(androidDir, 'gradlew');
  const gradlewBat = path.resolve(androidDir, 'gradlew.bat');
  const hasGradlew = existsSync(gradlewUnix) || (isWindows && existsSync(gradlewBat));
  const gradlewPath =
    isWindows && existsSync(gradlewBat)
      ? gradlewBat
      : existsSync(gradlewUnix)
        ? gradlewUnix
        : undefined;

  const detectedModules = await discoverGradleModules(androidDir);

  // Resolve target application module
  let selectedModule = options.appModule || 'app';
  let buildGradlePath = findModuleBuildGradle(androidDir, selectedModule);

  // If the default 'app' module does not exist, search discovered modules for com.android.application
  if (!buildGradlePath && !options.appModule && detectedModules.length > 0) {
    for (const mod of detectedModules) {
      const candidatePath = findModuleBuildGradle(androidDir, mod);
      if (candidatePath) {
        try {
          const content = await readFileUtf8(candidatePath);
          if (content.includes('com.android.application')) {
            selectedModule = mod;
            buildGradlePath = candidatePath;
            break;
          }
        } catch {
          // Ignore
        }
      }
    }

    // Fallback to first module with a build.gradle if none explicitly matched com.android.application
    if (!buildGradlePath) {
      for (const mod of detectedModules) {
        const candidatePath = findModuleBuildGradle(androidDir, mod);
        if (candidatePath) {
          selectedModule = mod;
          buildGradlePath = candidatePath;
          break;
        }
      }
    }
  }

  let applicationId: string | undefined;
  let namespace: string | undefined;
  let versionCode: number | undefined;
  let versionName: string | undefined;
  let flavors: string[] = [];
  let hasSigningConfigEnv = false;
  let usesDebugSigningInRelease = false;
  let hasReleaseSigningConfig = false;
  let signingDetails: AndroidSigningDetails | undefined;

  if (buildGradlePath) {
    try {
      const content = await readFileUtf8(buildGradlePath);
      const namespaceMatch = content.match(/namespace\s*=?\s*["']([^"']+)["']/);
      const appIdMatch = content.match(/applicationId\s*=?\s*["']([^"']+)["']/);
      const versionCodeMatch = content.match(/versionCode\s*=?\s*(\d+)/);
      const versionNameMatch = content.match(/versionName\s*=?\s*["']([^"']+)["']/);

      namespace = namespaceMatch?.[1];
      applicationId = appIdMatch?.[1] || namespace;
      if (versionCodeMatch?.[1]) {
        versionCode = parseInt(versionCodeMatch[1], 10);
      }
      versionName = versionNameMatch?.[1];
      flavors = parseFlavorsFromGradle(content);

      const parsedSigning = parseSigningDetailsFromGradle(content);
      signingDetails = parsedSigning;
      usesDebugSigningInRelease = parsedSigning.usesDebugSigningInRelease;
      hasReleaseSigningConfig = parsedSigning.hasReleaseSigningConfig;
      hasSigningConfigEnv = parsedSigning.hasEnvBasedSigning;
    } catch {
      // Ignored if unreadable
    }
  }

  return {
    hasAndroid: true,
    packagePath,
    buildGradleFound: buildGradlePath !== null,
    applicationId,
    namespace,
    versionCode,
    versionName,
    hasGradlew,
    gradlewPath,
    appModule: selectedModule,
    detectedModules,
    flavors: flavors.length > 0 ? flavors : undefined,
    hasSigningConfigEnv,
    usesDebugSigningInRelease,
    hasReleaseSigningConfig,
    signingDetails,
  };
}
