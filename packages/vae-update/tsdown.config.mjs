import { defineConfig } from 'tsdown'

/**
 * Browser module-table baseline this plugin may `require` at runtime. The
 * client half resolves these through the loader's frozen table, so they must
 * stay imports; everything else is inlined. Duplicated here on purpose: the
 * harness preset that owns this list lives inside the harness checkout, not in
 * an installable package.
 */
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

/** Exact-match externals so a subpath such as `react-dom/x` is bundled, not externalized by prefix. */
const PLATFORM_PATTERNS = PLATFORM_EXTERNALS.map(
  name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
)

/** Git installs run `prepare` against this file; keep it self-contained. */
export default defineConfig([
  {
    name: 'dsh-vae-update',
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
    name: 'dsh-vae-update/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    fixedExtension: false,
    // The host half may already be on disk: this pass must not clean the directory.
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: PLATFORM_PATTERNS,
      alwaysBundle: specifier => !PLATFORM_PATTERNS.some(pattern => pattern.test(specifier)),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // The client-module system loads this artifact outside Vite's graph: it
      // must register exactly one factory under this package's name.
      banner: 'window.__ModuleLoader__.load({ id: "dsh-vae-update", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
