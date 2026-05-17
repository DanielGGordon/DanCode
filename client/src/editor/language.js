// Map a file path's extension to a logical language name. The names here
// don't have to match any external taxonomy — they're keys for
// getLanguageExtension() below. Files with no recognised extension return
// null and open in plain-text mode.

const EXT_TO_LANG = {
  // JavaScript family
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript-jsx',
  // TypeScript family
  ts: 'typescript',
  tsx: 'typescript-tsx',
  // Other languages
  py: 'python',
  json: 'json',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'html', htm: 'html',
  css: 'css',
}

export function detectLanguageName(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  const name = filePath.split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] || null
}

// Lazily import the right CodeMirror language pack and return a CM Extension.
// Dynamic imports keep the initial bundle small and let unknown languages
// fall through to plain-text without loading anything.
export async function getLanguageExtension(languageName) {
  if (!languageName) return null
  switch (languageName) {
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
    case 'javascript-jsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true })
    }
    case 'typescript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ typescript: true })
    }
    case 'typescript-tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true, typescript: true })
    }
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json')
      return json()
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    case 'yaml': {
      const { yaml } = await import('@codemirror/lang-yaml')
      return yaml()
    }
    case 'html': {
      const { html } = await import('@codemirror/lang-html')
      return html()
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css')
      return css()
    }
    case 'bash': {
      const [{ StreamLanguage }, { shell }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/shell'),
      ])
      return StreamLanguage.define(shell)
    }
    default:
      return null
  }
}
