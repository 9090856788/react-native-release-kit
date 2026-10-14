import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /"private_key"\s*:\s*"[^"]+"/gi,
  /password\s*[:=]\s*([^\s,;]+)/gi,
  /secret\s*[:=]\s*([^\s,;]+)/gi,
  /token\s*[:=]\s*([^\s,;]+)/gi,
  /key\s*[:=]\s*([^\s,;]+)/gi,
  /bearer\s+([a-zA-Z0-9_\-\.]+)/gi,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
];

const registeredSecrets = new Set<string>();

/**
 * Registers a sensitive runtime value so any accidental occurrence in logs or subprocess output is redacted.
 */
export function registerSecretForRedaction(secretValue: string | undefined): void {
  if (!secretValue) return;
  const trimmed = secretValue.trim();
  if (trimmed.length >= 4) {
    registeredSecrets.add(trimmed);
  }
}

export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

export function maskSecrets(message: string): string {
  if (!message) return message;
  let sanitized = message;

  for (const secret of registeredSecrets) {
    if (sanitized.includes(secret)) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.startsWith('-----BEGIN')) {
        return '[REDACTED_PRIVATE_KEY]';
      }
      if (match.toLowerCase().startsWith('"private_key"')) {
        return '"private_key": "[REDACTED]"';
      }
      if (match.includes(':') || match.includes('=')) {
        const parts = match.split(/[:=]/);
        return `${parts[0]}: [REDACTED]`;
      }
      return '[REDACTED_SECRET]';
    });
  }
  return sanitized;
}

export class Logger {
  private level: LogLevel = 'info';

  constructor(options?: LoggerOptions) {
    if (options?.level) {
      this.level = options.level;
    }
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public isDebug(): boolean {
    return this.level === 'debug';
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    if (this.level === 'silent') return false;
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentIdx = levels.indexOf(this.level);
    const msgIdx = levels.indexOf(messageLevel);
    return msgIdx >= currentIdx;
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      const sanitized = maskSecrets(message);
      console.debug(pc.dim(`[DEBUG] ${sanitized}`), ...args);
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const sanitized = maskSecrets(message);
      console.log(pc.blue('ℹ') + ' ' + sanitized, ...args);
    }
  }

  public success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const sanitized = maskSecrets(message);
      console.log(pc.green('✔') + ' ' + pc.bold(sanitized), ...args);
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      const sanitized = maskSecrets(message);
      console.warn(pc.yellow('⚠') + ' ' + pc.yellow(sanitized), ...args);
    }
  }

  public error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      const sanitized = maskSecrets(message);
      console.error(pc.red('✖') + ' ' + pc.red(sanitized), ...args);
    }
  }

  public raw(message: string): void {
    if (this.level !== 'silent') {
      console.log(maskSecrets(message));
    }
  }
}

export const logger = new Logger();
