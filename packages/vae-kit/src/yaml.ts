/**
 * Small YAML reader/writer for this kit's files. Catalog, extensions, and
 * server declarations use nested maps, string arrays, and scalars only.
 * @module
 */

/**
 * Parse a YAML document that is a map or array at the top level.
 * @param text - document text.
 * @returns the parsed value.
 */
export function parseYaml(text: string): unknown {
  const lines = tokenize(text)
  if (lines.length === 0) return {}
  const [value, next] = parseBlock(lines, 0, 0)
  if (next !== lines.length) {
    throw new Error(`yaml: unexpected content at line ${lines[next]!.line}`)
  }
  return value
}

/**
 * Write a JSON-compatible map as YAML. Keys stay in insertion order.
 * @param value - JSON-compatible value.
 * @returns YAML text ending in a newline.
 */
export function stringifyYaml(value: unknown): string {
  const body = emit(value, 0)
  return body.length === 0 ? '{}\n' : `${body}\n`
}

interface TokenLine {
  line: number
  indent: number
  text: string
}

function tokenize(text: string): TokenLine[] {
  const result: TokenLine[] = []
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (let i = 0; i < raw.length; i++) {
    const original = raw[i]!
    const stripped = stripComment(original)
    if (stripped.trim() === '') continue
    const indent = leadingSpaces(stripped)
    if (stripped[indent] === '\t') {
      throw new Error(`yaml: tabs are not allowed (line ${i + 1})`)
    }
    result.push({ line: i + 1, indent, text: stripped.slice(indent) })
  }
  return result
}

function leadingSpaces(value: string): number {
  let n = 0
  while (n < value.length && value[n] === ' ') n++
  return n
}

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i).trimEnd()
  }
  return line
}

function parseBlock(lines: TokenLine[], index: number, indent: number): [unknown, number] {
  const first = lines[index]
  if (first === undefined) return [{}, index]
  if (first.indent < indent) return [{}, index]
  if (first.text === '{}') return [{}, index + 1]
  if (first.text === '[]') return [[], index + 1]
  if (first.text.startsWith('- ')) return parseArray(lines, index, first.indent)
  return parseMap(lines, index, first.indent)
}

function parseMap(lines: TokenLine[], index: number, indent: number): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {}
  let i = index
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent) {
      throw new Error(`yaml: unexpected indent at line ${line.line}`)
    }
    const colon = splitKey(line.text)
    if (colon === undefined) {
      throw new Error(`yaml: expected "key:" at line ${line.line}`)
    }
    const { key, rest } = colon
    if (key in result) throw new Error(`yaml: duplicate key "${key}" at line ${line.line}`)
    if (rest !== '') {
      result[key] = parseScalar(rest, line.line)
      i++
      continue
    }
    const next = lines[i + 1]
    if (next === undefined || next.indent <= indent) {
      result[key] = {}
      i++
      continue
    }
    const [child, after] = parseBlock(lines, i + 1, next.indent)
    result[key] = child
    i = after
  }
  return [result, i]
}

function parseArray(lines: TokenLine[], index: number, indent: number): [unknown[], number] {
  const result: unknown[] = []
  let i = index
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent) throw new Error(`yaml: unexpected indent at line ${line.line}`)
    if (!line.text.startsWith('- ')) {
      throw new Error(`yaml: expected list item at line ${line.line}`)
    }
    const rest = line.text.slice(2)
    if (rest === '') {
      const next = lines[i + 1]
      if (next === undefined || next.indent <= indent) {
        result.push({})
        i++
        continue
      }
      const [child, after] = parseBlock(lines, i + 1, next.indent)
      result.push(child)
      i = after
      continue
    }
    if (rest.includes(': ') || rest.endsWith(':')) {
      const fake: TokenLine[] = [{ line: line.line, indent: indent + 2, text: rest }]
      let j = i + 1
      while (j < lines.length && lines[j]!.indent > indent) {
        fake.push(lines[j]!)
        j++
      }
      const [child] = parseMap(fake, 0, indent + 2)
      result.push(child)
      i = j
      continue
    }
    result.push(parseScalar(rest, line.line))
    i++
  }
  return [result, i]
}

function splitKey(text: string): { key: string; rest: string } | undefined {
  if (text.startsWith('"') || text.startsWith("'")) {
    const key = parseQuoted(text)
    const after = text.slice(quotedLength(text)).trim()
    if (!after.startsWith(':')) return undefined
    return { key, rest: after.slice(1).trim() }
  }
  const idx = text.indexOf(':')
  if (idx <= 0) return undefined
  const key = text.slice(0, idx).trim()
  if (key.length === 0 || key.includes(' ')) return undefined
  return { key, rest: text.slice(idx + 1).trim() }
}

function parseScalar(text: string, line: number): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (text === '{}') return {}
  if (text === '[]') return []
  if (text.startsWith('[') && text.endsWith(']')) return parseFlowSequence(text, line)
  if (/^-?\d+$/.test(text)) return Number(text)
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return parseQuoted(text)
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    throw new Error(`yaml: unterminated string at line ${line}`)
  }
  return text
}

function parseFlowSequence(text: string, line: number): unknown[] {
  const inner = text.slice(1, -1).trim()
  if (inner === '') return []
  return inner.split(',').map((part) => {
    const item = part.trim()
    if (item === '') throw new Error(`yaml: empty list item at line ${line}`)
    return parseScalar(item, line)
  })
}

function parseQuoted(text: string): string {
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return text
  let out = ''
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'" && ch === "'") {
      if (text[i + 1] === "'") {
        out += "'"
        i++
        continue
      }
      return out
    }
    if (quote === '"' && ch === '\\') {
      const next = text[i + 1]
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' }
      out += map[next ?? ''] ?? next ?? ''
      i++
      continue
    }
    if (quote === '"' && ch === '"') return out
    out += ch
  }
  throw new Error('yaml: unterminated string')
}

function quotedLength(text: string): number {
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return text.length
  for (let i = 1; i < text.length; i++) {
    if (quote === "'" && text[i] === "'") {
      if (text[i + 1] === "'") {
        i++
        continue
      }
      return i + 1
    }
    if (quote === '"' && text[i] === '\\') {
      i++
      continue
    }
    if (quote === '"' && text[i] === '"') return i + 1
  }
  return text.length
}

function emit(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return emitString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map((item) => {
      const pad = ' '.repeat(indent)
      if (isPlainMap(item) || Array.isArray(item)) {
        const inner = emit(item, indent + 2)
        return `${pad}- ${inner}`
      }
      return `${pad}- ${emit(item, 0)}`
    }).join('\n')
  }
  if (isPlainMap(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    return keys.map((key) => {
      const pad = ' '.repeat(indent)
      const child = value[key]
      if (isPlainMap(child) || Array.isArray(child)) {
        const inner = emit(child, indent + 2)
        if (inner === '{}' || inner === '[]') return `${pad}${key}: ${inner}`
        return `${pad}${key}:\n${inner}`
      }
      return `${pad}${key}: ${emit(child, 0)}`
    }).join('\n')
  }
  throw new Error(`yaml: cannot write ${typeof value}`)
}

function emitString(value: string): string {
  if (value === '' || /[:#\n]|^\s|\s$/.test(value) || value === 'true' || value === 'false' || value === 'null') {
    return JSON.stringify(value)
  }
  return value
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
