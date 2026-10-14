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
  private prefix?: string;

  constructor(options?: LoggerOptions) {
    if (options?.level) {
      this.level = options.level;
    }
    if (options?.prefix && options.prefix.trim().length > 0) {
      this.prefix = options.prefix.trim();
    }
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public getPrefix(): string | undefined {
    return this.prefix;
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

  private formatMessage(message: string): string {
    const sanitized = maskSecrets(message);
    return this.prefix ? `[${this.prefix}] ${sanitized}` : sanitized;
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage(message);
      console.debug(pc.dim(`[DEBUG] ${formatted}`), ...args);
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage(message);
      console.log(pc.blue('ℹ') + ' ' + formatted, ...args);
    }
  }

  public success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage(message);
      console.log(pc.green('✔') + ' ' + pc.bold(formatted), ...args);
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage(message);
      console.warn(pc.yellow('⚠') + ' ' + pc.yellow(formatted), ...args);
    }
  }

  public error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      const formatted = this.formatMessage(message);
      console.error(pc.red('✖') + ' ' + pc.red(formatted), ...args);
    }
  }

  public raw(message: string): void {
    if (this.level !== 'silent') {
      console.log(maskSecrets(message));
    }
  }
}

export const logger = new Logger();
