/**
 * Read and write extensions.yml documents.
 * @module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseExtensions, stringifyExtensions } from './resolve.ts'
import type { ExtensionsDoc } from './types.ts'

/**
 * Read an extensions file; missing files are an empty document.
 * @param path - absolute extensions.yml path.
 * @returns the parsed document.
 */
export async function readExtensionsFile(path: string): Promise<ExtensionsDoc> {
  try {
    return parseExtensions(await readFile(path, 'utf8'))
  } catch (error) {
    if (isAbsent(error)) return parseExtensions(undefined)
    throw error
  }
}

/**
 * Write an extensions document, creating parent directories.
 * @param path - absolute extensions.yml path.
 * @param doc - document to serialize.
 */
export async function writeExtensionsFile(path: string, doc: ExtensionsDoc): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const body = stringifyExtensions(doc)
  await writeFile(path, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
}

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
