import fs from 'node:fs/promises';
import path from 'node:path';

export type AndroidGradleDsl = 'groovy' | 'kotlin';

export interface AndroidSigningConfigResult {
  changed: boolean;
  filePath: string;
  dsl: AndroidGradleDsl;
  content: string;
  message: string;
}

export interface AndroidSigningConfigOptions {
  projectRoot: string;
  androidDir?: string;
  appModule?: string;
  dryRun?: boolean;
}

export interface BlockNode {
  name: string;
  start: number;
  openBrace: number;
  closeBrace: number;
  indent: string;
  children: BlockNode[];
  parent?: BlockNode;
}

function detectDsl(filePath: string): AndroidGradleDsl {
  return filePath.endsWith('.gradle.kts') ? 'kotlin' : 'groovy';
}

/**
 * Tokenizes a Gradle file into a hierarchy of named blocks while accounting for
 * single-line comments, block comments, and single/double/triple-quoted strings.
 * Throws on unbalanced braces, unclosed comments, or unclosed strings.
 */
export function parseGradleBlocks(source: string): BlockNode[] {
  const roots: BlockNode[] = [];
  const stack: BlockNode[] = [];

  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    // 1. Line comment: // until \n or EOF
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // 2. Block comment: /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < len) {
        if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        throw new Error('Malformed Gradle file: unclosed block comment (/* ... */).');
      }
      continue;
    }

    // 3. Triple-single quote: ''' ... '''
    if (ch === "'" && next === "'" && i + 2 < len && source[i + 2] === "'") {
      i += 3;
      let closed = false;
      while (i < len) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (
          source[i] === "'" &&
          i + 1 < len &&
          source[i + 1] === "'" &&
          i + 2 < len &&
          source[i + 2] === "'"
        ) {
          i += 3;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        throw new Error("Malformed Gradle file: unclosed triple-quoted string ('''...''').");
      }
      continue;
    }

    // 4. Triple-double quote: """ ... """
    if (ch === '"' && next === '"' && i + 2 < len && source[i + 2] === '"') {
      i += 3;
      let closed = false;
      while (i < len) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (
          source[i] === '"' &&
          i + 1 < len &&
          source[i + 1] === '"' &&
          i + 2 < len &&
          source[i + 2] === '"'
        ) {
          i += 3;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        throw new Error('Malformed Gradle file: unclosed triple-quoted string ("""...""").');
      }
      continue;
    }

    // 5. Single-quoted string: '...'
    if (ch === "'") {
      i += 1;
      let closed = false;
      while (i < len) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        if (source[i] === '\n') {
          throw new Error('Malformed Gradle file: unclosed single-quoted string.');
        }
        i += 1;
      }
      if (!closed) {
        throw new Error('Malformed Gradle file: unclosed single-quoted string.');
      }
      continue;
    }

    // 6. Double-quoted string: "..."
    if (ch === '"') {
      i += 1;
      let closed = false;
      while (i < len) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        if (source[i] === '\n') {
          throw new Error('Malformed Gradle file: unclosed double-quoted string.');
        }
        i += 1;
      }
      if (!closed) {
        throw new Error('Malformed Gradle file: unclosed double-quoted string.');
      }
      continue;
    }

    // 7. Opening brace: {
    if (ch === '{') {
      const preceding = source.slice(0, i);
      const headerMatch = preceding.match(
        /(?:^|[\r\n;{}])([ \t]*)([a-zA-Z0-9_.-]+(?:\s*\([^)]*\))?)\s*$/,
      );

      let blockName = '';
      let identStart = i;
      let indent = '    ';

      if (headerMatch && headerMatch[2]) {
        const rawDecl = headerMatch[2].trim();
        indent = headerMatch[1] || '';
        const matchStart = i - headerMatch[0].length;
        const identOffset = headerMatch[0].lastIndexOf(headerMatch[2]);
        identStart = matchStart + identOffset;

        const callMatch = rawDecl.match(
          /^(?:create|getByName|named)\s*\(\s*["']([^"']+)["']\s*\)$/,
        );
        if (callMatch && callMatch[1]) {
          blockName = callMatch[1];
        } else {
          blockName = rawDecl;
        }
      }

      const node: BlockNode = {
        name: blockName,
        start: identStart,
        openBrace: i,
        closeBrace: -1,
        indent,
        children: [],
        parent: stack[stack.length - 1],
      };

      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(node);
      } else {
        roots.push(node);
      }

      stack.push(node);
      i += 1;
      continue;
    }

    // 8. Closing brace: }
    if (ch === '}') {
      if (stack.length === 0) {
        throw new Error(`Malformed Gradle file: unexpected closing brace '}' at position ${i}.`);
      }
      const top = stack.pop()!;
      top.closeBrace = i;
      i += 1;
      continue;
    }

    i += 1;
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!;
    throw new Error(
      `Malformed Gradle file: unclosed block "${unclosed.name}" (missing closing brace).`,
    );
  }

  return roots;
}

function findRootBlock(roots: BlockNode[], name: string): BlockNode | undefined {
  const matches = roots.filter((r) => r.name === name);
  if (matches.length > 1) {
    throw new Error(`Multiple "${name}" blocks were found. No changes were made.`);
  }
  return matches[0];
}

function requireUniqueRootBlock(roots: BlockNode[], name: string): BlockNode {
  const block = findRootBlock(roots, name);
  if (!block) {
    throw new Error(`Could not safely identify the "${name}" block in build.gradle.`);
  }
  return block;
}

function findChildBlock(parent: BlockNode, name: string): BlockNode | undefined {
  const matches = parent.children.filter((c) => c.name === name);
  if (matches.length > 1) {
    throw new Error(
      `Multiple "${name}" blocks were found in the same scope. No changes were made.`,
    );
  }
  return matches[0];
}

function requireUniqueChildBlock(parent: BlockNode, name: string): BlockNode {
  const block = findChildBlock(parent, name);
  if (!block) {
    throw new Error(`Could not safely identify the "${name}" block.`);
  }
  return block;
}

/**
 * Searches for a statement matching pattern outside of comments and strings.
 */
function findUncommentedStatement(
  source: string,
  pattern: RegExp,
): { start: number; end: number; match: RegExpMatchArray } | undefined {
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    // 1. Line comment //
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // 2. Block comment /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len) {
        if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    // 3. Strings '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < len) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    const sub = source.slice(i);
    const m = sub.match(pattern);
    if (m && sub.startsWith(m[0])) {
      return { start: i, end: i + m[0].length, match: m };
    }

    i += 1;
  }

  return undefined;
}

function hasExistingReleaseSigning(
  source: string,
  androidBlock: BlockNode,
  signingConfigsBlock?: BlockNode,
): boolean {
  if (signingConfigsBlock) {
    if (signingConfigsBlock.children.some((c) => c.name === 'release')) {
      return true;
    }
    const signingContent = source.slice(
      signingConfigsBlock.openBrace + 1,
      signingConfigsBlock.closeBrace,
    );
    if (
      /\brelease\s*\{/.test(signingContent) ||
      /\b(?:create|getByName|named)\s*\(\s*["']release["']\s*\)/.test(signingContent)
    ) {
      return true;
    }
  }

  const androidContent = source.slice(androidBlock.openBrace + 1, androidBlock.closeBrace);
  return (
    /signingConfigs\s*\.\s*create\s*\(\s*["']release["']/.test(androidContent) ||
    /signingConfigs\s*\.\s*getByName\s*\(\s*["']release["']/.test(androidContent) ||
    /signingConfigs\s*\.\s*release\b/.test(androidContent)
  );
}

/**
 * Configures environment-backed Android release signing for a supported
 * Groovy Gradle file. It never writes credentials into the Gradle source.
 */
export async function configureAndroidReleaseSigning(
  options: AndroidSigningConfigOptions,
): Promise<AndroidSigningConfigResult> {
  const appModule = options.appModule ?? 'app';
  const androidRoot = options.androidDir ?? path.join(options.projectRoot, 'android');

  const candidates = [
    path.join(androidRoot, appModule, 'build.gradle'),
    path.join(androidRoot, appModule, 'build.gradle.kts'),
  ];

  const existingFiles: string[] = [];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      existingFiles.push(candidate);
    } catch {
      // File does not exist.
    }
  }

  if (existingFiles.length === 0) {
    throw new Error(
      `Could not find build.gradle or build.gradle.kts for Android module "${appModule}".`,
    );
  }

  if (existingFiles.length > 1) {
    throw new Error(
      `Both Groovy and Kotlin Gradle files exist for module "${appModule}". Refusing to choose automatically.`,
    );
  }

  const filePath = existingFiles[0]!;
  const dsl = detectDsl(filePath);
  const original = await fs.readFile(filePath, 'utf8');

  if (dsl === 'kotlin') {
    throw new Error(
      'Automatic Kotlin DSL editing is not enabled yet. No changes were written to build.gradle.kts.',
    );
  }

  // Parse block tree of original file
  const roots = parseGradleBlocks(original);
  const androidBlock = requireUniqueRootBlock(roots, 'android');
  const buildTypesBlock = requireUniqueChildBlock(androidBlock, 'buildTypes');
  const releaseBlock = requireUniqueChildBlock(buildTypesBlock, 'release');
  const debugBlock = findChildBlock(buildTypesBlock, 'debug');
  const signingConfigsBlock = findChildBlock(androidBlock, 'signingConfigs');

  // Check if release signing configuration already exists
  if (hasExistingReleaseSigning(original, androidBlock, signingConfigsBlock)) {
    return {
      changed: false,
      filePath,
      dsl,
      content: original,
      message:
        'A release signing configuration may already exist. No changes were made; inspect it before proceeding.',
    };
  }

  // Inspect release build type content for signingConfig statements
  const releaseContent = original.slice(releaseBlock.openBrace + 1, releaseBlock.closeBrace);
  const debugSigningStmt = findUncommentedStatement(
    releaseContent,
    /^signingConfig(\s*(?:=\s*)?|\s*\(\s*)signingConfigs(?:\.debug\b|\[\s*['"]debug['"]\s*\]|\.getByName\s*\(\s*['"]debug['"]\s*\))(?:\s*\))?/,
  );
  const releaseSigningStmt = findUncommentedStatement(
    releaseContent,
    /^signingConfig(\s*(?:=\s*)?|\s*\(\s*)signingConfigs(?:\.release\b|\[\s*['"]release['"]\s*\]|\.getByName\s*\(\s*['"]release['"]\s*\))(?:\s*\))?/,
  );
  const anySigningStmt = findUncommentedStatement(releaseContent, /^signingConfig\b/);

  if (releaseSigningStmt) {
    return {
      changed: false,
      filePath,
      dsl,
      content: original,
      message:
        'A release signing configuration may already exist. No changes were made; inspect it before proceeding.',
    };
  }

  if (anySigningStmt && !debugSigningStmt) {
    throw new Error(
      'The release build type has a custom signingConfig reference. No changes were made; inspect the existing configuration.',
    );
  }

  if (!debugSigningStmt) {
    throw new Error(
      'The release build type does not use the standard debug signing configuration (signingConfigs.debug). No changes were made; inspect the existing configuration.',
    );
  }

  // Step 1: Update the release block in buildTypes
  const hasParen =
    debugSigningStmt.match[0].includes('(') && debugSigningStmt.match[0].includes(')');
  const sep = debugSigningStmt.match[1] || ' ';
  const replacement = hasParen
    ? 'signingConfig(signingConfigs.release)'
    : `signingConfig${sep}signingConfigs.release`;

  const updatedReleaseBody =
    releaseContent.slice(0, debugSigningStmt.start) +
    replacement +
    releaseContent.slice(debugSigningStmt.end);

  let updated =
    original.slice(0, releaseBlock.openBrace + 1) +
    updatedReleaseBody +
    original.slice(releaseBlock.closeBrace);

  // Step 2: Add release signing config block
  // Re-parse to get exact block positions in updated content
  const step1Roots = parseGradleBlocks(updated);
  const step1Android = requireUniqueRootBlock(step1Roots, 'android');
  const step1SigningConfigs = findChildBlock(step1Android, 'signingConfigs');
  const step1BuildTypes = requireUniqueChildBlock(step1Android, 'buildTypes');

  if (step1SigningConfigs) {
    const blockIndent = step1SigningConfigs.indent || '    ';
    const innerIndent = `${blockIndent}    `;
    const codeIndent = `${innerIndent}    `;

    const releaseSigningBlock = `${innerIndent}release {
${codeIndent}def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
${codeIndent}def keystorePasswordValue = System.getenv("ANDROID_KEYSTORE_PASSWORD")
${codeIndent}def keyAliasValue = System.getenv("ANDROID_KEY_ALIAS")
${codeIndent}def keyPasswordValue = System.getenv("ANDROID_KEY_PASSWORD")

${codeIndent}if (keystorePath) storeFile file(keystorePath)
${codeIndent}if (keystorePasswordValue) storePassword keystorePasswordValue
${codeIndent}if (keyAliasValue) keyAlias keyAliasValue
${codeIndent}if (keyPasswordValue) keyPassword keyPasswordValue
${innerIndent}}
`;

    updated =
      updated.slice(0, step1SigningConfigs.closeBrace) +
      releaseSigningBlock +
      updated.slice(step1SigningConfigs.closeBrace);
  } else {
    const blockIndent = step1BuildTypes.indent || '    ';
    const innerIndent = `${blockIndent}    `;
    const codeIndent = `${innerIndent}    `;

    const newSigningConfigsBlock = `${blockIndent}signingConfigs {
${innerIndent}release {
${codeIndent}def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
${codeIndent}def keystorePasswordValue = System.getenv("ANDROID_KEYSTORE_PASSWORD")
${codeIndent}def keyAliasValue = System.getenv("ANDROID_KEY_ALIAS")
${codeIndent}def keyPasswordValue = System.getenv("ANDROID_KEY_PASSWORD")

${codeIndent}if (keystorePath) storeFile file(keystorePath)
${codeIndent}if (keystorePasswordValue) storePassword keystorePasswordValue
${codeIndent}if (keyAliasValue) keyAlias keyAliasValue
${codeIndent}if (keyPasswordValue) keyPassword keyPasswordValue
${innerIndent}}
${blockIndent}}
`;

    updated =
      updated.slice(0, step1BuildTypes.start) +
      newSigningConfigsBlock +
      updated.slice(step1BuildTypes.start);
  }

  // Step 3: Validate the updated content
  const finalRoots = parseGradleBlocks(updated);
  const finalAndroid = requireUniqueRootBlock(finalRoots, 'android');
  const finalBuildTypes = requireUniqueChildBlock(finalAndroid, 'buildTypes');
  const finalRelease = requireUniqueChildBlock(finalBuildTypes, 'release');
  const finalSigningConfigs = requireUniqueChildBlock(finalAndroid, 'signingConfigs');
  requireUniqueChildBlock(finalSigningConfigs, 'release');

  const finalReleaseContent = updated.slice(finalRelease.openBrace + 1, finalRelease.closeBrace);
  const finalReleaseSigning = findUncommentedStatement(
    finalReleaseContent,
    /^signingConfig(\s*(?:=\s*)?|\s*\(\s*)signingConfigs\.release\b/,
  );
  if (!finalReleaseSigning) {
    throw new Error('Verification failed: release block was not configured with release signing.');
  }

  // Ensure debug block was preserved verbatim
  if (debugBlock) {
    const finalDebug = findChildBlock(finalBuildTypes, 'debug');
    if (!finalDebug) {
      throw new Error('Verification failed: debug block was lost.');
    }
    const origDebugText = original.slice(debugBlock.start, debugBlock.closeBrace + 1);
    const finalDebugText = updated.slice(finalDebug.start, finalDebug.closeBrace + 1);
    if (origDebugText !== finalDebugText) {
      throw new Error('Verification failed: debug block was modified.');
    }
  }

  if (options.dryRun) {
    return {
      changed: updated !== original,
      filePath,
      dsl,
      content: updated,
      message: 'Dry run: proposed changes were not written.',
    };
  }

  await fs.writeFile(filePath, updated, 'utf8');

  return {
    changed: updated !== original,
    filePath,
    dsl,
    content: updated,
    message: 'Configured environment-backed Android release signing.',
  };
}
