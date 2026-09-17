import { defineConfig } from 'tsdown'

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const PLATFORM_PATTERNS = PLATFORM_EXTERNALS.map(
  name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
)

/** Git installs run `prepare` against this file; keep it self-contained. */
export default defineConfig([
  {
    name: 'dsh-vae-kit',
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    fixedExtension: false,
    clean: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    name: 'dsh-vae-kit/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    fixedExtension: false,
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: PLATFORM_PATTERNS,
      alwaysBundle: specifier => !PLATFORM_PATTERNS.some(pattern => pattern.test(specifier)),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-vae-kit", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
