import { defineConfig } from 'tsdown'

/** Git installs run `prepare` against this file; keep it self-contained. */
export default defineConfig({
  entry: ['src/index.ts', 'src/greeting.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  fixedExtension: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
})
