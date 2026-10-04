import type { ReaderPrefs } from '../../../../shared/types'
import { fontFamilyOf, readingFontCss } from '../../styles/fonts'
import type { PageThemeDef } from '../page-themes'

/**
 * CSS injected into every book section. Returned as [before, after]:
 * "before" is prepended (book CSS can override it), "after" is appended (wins).
 */
export function bookCss(p: ReaderPrefs, t: PageThemeDef, accent: string): [string, string] {
  const family = p.fontFamily === 'original' ? '' : fontFamilyOf(p.fontFamily)
  const override = p.overrideBookStyles
  const before = `
@namespace epub "http://www.idpf.org/2007/ops";
${readingFontCss}
html { color-scheme: ${t.dark ? 'dark' : 'light'}; }
body { line-height: ${p.lineHeight}; }
p, li, blockquote, dd, div { line-height: ${p.lineHeight}; }
p, li, blockquote, dd {
  text-align: ${p.justify ? 'justify' : 'start'};
  -webkit-hyphens: manual;
  hyphens: manual;
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
[align="justify"] { text-align: justify; }
pre { white-space: pre-wrap !important; }
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
`
  const colorRules = t.dark || override
    ? `
body *:not(img):not(svg):not(svg *):not(video):not(mark) { color: inherit !important; background-color: transparent !important; border-color: color-mix(in srgb, currentColor 30%, transparent) !important; }
a:link, a:visited, a:link *, a:visited * { color: ${t.link} !important; }`
    : `
a:link, a:visited { color: ${t.link}; }`
  const after = `
html { font-size: ${p.fontSize}px !important; }
html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
body { font-size: ${p.fontSize}px !important; ${family ? `font-family: ${family} !important;` : ''} }
${family ? `body *:not(pre):not(code):not(kbd):not(samp):not(tt):not(svg):not(svg *):not(math):not(math *) { font-family: inherit !important; }` : ''}
p, li, blockquote, dd { line-height: ${p.lineHeight} !important; }
${override ? `p, li, dd, blockquote { font-size: 1em !important; margin-top: 0 !important; margin-bottom: ${p.paragraphIndent ? '0' : '.7em'} !important; text-indent: ${p.paragraphIndent ? '1.5em' : '0'} !important; text-align: ${p.justify ? 'justify' : 'start'} !important; }` : ''}
${!p.paragraphIndent ? `p { text-indent: 0 !important; } p + p { margin-top: .65em !important; }` : ''}
${colorRules}
::selection { background: color-mix(in srgb, ${accent} 32%, transparent); }
img, svg, video { ${t.dark ? 'filter: brightness(.9);' : ''} }
mark { background: color-mix(in srgb, ${accent} 30%, transparent); color: inherit; }
`
  return [before, after]
}
