import { defineConfig } from 'tsup';
import fs from 'node:fs';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);
const pkgVersion = process.env.npm_package_version || packageJson.version;

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  define: {
    __RELEASE_KIT_VERSION__: JSON.stringify(pkgVersion),
  },
});
