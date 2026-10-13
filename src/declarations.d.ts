declare module 'js-yaml' {
  export interface LoadOptions {
    filename?: string;
    onWarning?: (e: Error) => void;
    schema?: unknown;
    json?: boolean;
  }

  export function load(input: string, options?: LoadOptions): unknown;
  export function dump(input: unknown, options?: unknown): string;
}

