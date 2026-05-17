import { describe, it, expect } from 'vitest'
import { detectLanguageName, getLanguageExtension } from './language.js'

describe('detectLanguageName', () => {
  it('maps JavaScript extensions', () => {
    expect(detectLanguageName('foo.js')).toBe('javascript')
    expect(detectLanguageName('foo.mjs')).toBe('javascript')
    expect(detectLanguageName('foo.cjs')).toBe('javascript')
    expect(detectLanguageName('foo.jsx')).toBe('javascript-jsx')
  })

  it('maps TypeScript extensions', () => {
    expect(detectLanguageName('foo.ts')).toBe('typescript')
    expect(detectLanguageName('foo.tsx')).toBe('typescript-tsx')
  })

  it('maps Python', () => {
    expect(detectLanguageName('script.py')).toBe('python')
  })

  it('maps JSON', () => {
    expect(detectLanguageName('package.json')).toBe('json')
  })

  it('maps Markdown', () => {
    expect(detectLanguageName('README.md')).toBe('markdown')
    expect(detectLanguageName('readme.markdown')).toBe('markdown')
  })

  it('maps YAML', () => {
    expect(detectLanguageName('config.yml')).toBe('yaml')
    expect(detectLanguageName('config.yaml')).toBe('yaml')
  })

  it('maps Bash/shell', () => {
    expect(detectLanguageName('install.sh')).toBe('bash')
    expect(detectLanguageName('install.bash')).toBe('bash')
    expect(detectLanguageName('install.zsh')).toBe('bash')
  })

  it('maps HTML', () => {
    expect(detectLanguageName('index.html')).toBe('html')
    expect(detectLanguageName('index.htm')).toBe('html')
  })

  it('maps CSS', () => {
    expect(detectLanguageName('style.css')).toBe('css')
  })

  it('returns null for unknown extensions', () => {
    expect(detectLanguageName('foo.xyz')).toBeNull()
    expect(detectLanguageName('LICENSE')).toBeNull()
    expect(detectLanguageName('foo')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(detectLanguageName('README.MD')).toBe('markdown')
    expect(detectLanguageName('SCRIPT.PY')).toBe('python')
  })

  it('handles paths with directories', () => {
    expect(detectLanguageName('src/main/foo.js')).toBe('javascript')
    expect(detectLanguageName('/abs/path/to/file.py')).toBe('python')
  })
})

describe('getLanguageExtension', () => {
  it('returns a CodeMirror Extension for known languages', async () => {
    const ext = await getLanguageExtension('javascript')
    expect(ext).toBeDefined()
    // A CM Extension is either an array or an object with extension property
    expect(typeof ext === 'object').toBe(true)
  })

  it('returns null for unknown languages', async () => {
    const ext = await getLanguageExtension(null)
    expect(ext).toBeNull()
    const ext2 = await getLanguageExtension('plain-text')
    expect(ext2).toBeNull()
  })

  it('returns extension for bash via legacy-modes', async () => {
    const ext = await getLanguageExtension('bash')
    expect(ext).toBeDefined()
  })

  it('returns extension for python', async () => {
    const ext = await getLanguageExtension('python')
    expect(ext).toBeDefined()
  })

  it('returns extension for yaml', async () => {
    const ext = await getLanguageExtension('yaml')
    expect(ext).toBeDefined()
  })

  it('returns extension for tsx', async () => {
    const ext = await getLanguageExtension('typescript-tsx')
    expect(ext).toBeDefined()
  })

  it('returns extension for jsx', async () => {
    const ext = await getLanguageExtension('javascript-jsx')
    expect(ext).toBeDefined()
  })
})
