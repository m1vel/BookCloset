# Third-party components

BookCloset bundles or depends on the following components. Their licenses apply to the respective code.

| Component | Where | License |
|---|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js) | `src/renderer/src/vendor/foliate-js` (vendored, with BookCloset patches marked in the code) | MIT |
| zip.js (bundled in foliate-js) | `src/renderer/src/vendor/foliate-js/vendor/zip.js` | BSD-3-Clause |
| fflate (bundled in foliate-js and as a dependency) | — | MIT |
| [DjVu.js](https://github.com/RussCoder/djvujs) | `src/renderer/public/vendor/djvu.js` | **GPL-2.0-or-later** |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | dependency | Apache-2.0 |
| [7z-wasm](https://github.com/use-strict/7z-wasm) (7-Zip) | dependency | GNU LGPL + unRAR restriction |
| mammoth | dependency | BSD-2-Clause |
| rtf.js | dependency | MIT |
| word-extractor | dependency | MIT |
| marked | dependency | MIT |
| jschardet | dependency | LGPL-2.1+ |
| hyphen | dependency | ISC |
| React, zustand, Phosphor Icons | dependencies | MIT |
| @anthropic-ai/sdk | dependency | MIT |
| Electron | runtime | MIT |
| Fonts: Literata, PT Serif, PT Sans, Lora, Source Serif 4, Cormorant Garamond, Inter, Manrope (Fontsource) | dependencies | SIL OFL 1.1 |

**Note on licensing BookCloset itself.** DjVu.js is licensed under the GPL, and 7-Zip carries the
unRAR restriction. Take this into account when choosing a license for BookCloset and when
distributing builds. The project does not declare its own license yet (`"license": "UNLICENSED"`
in `package.json`).
