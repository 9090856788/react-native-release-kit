import { defineConfig } from 'vitest/config';
import fs from 'node:fs';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);
const pkgVersion = process.env.npm_package_version || packageJson.version;

export default defineConfig({
  define: {
    __RELEASE_KIT_VERSION__: JSON.stringify(pkgVersion),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts', 'src/**/types.ts'],
    },
  },
});
