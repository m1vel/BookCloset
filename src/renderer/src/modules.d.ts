declare module 'hyphen/*' {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number; exceptions?: string[] }): string
}

declare module '*.css?inline' {
  const css: string
  export default css
}

declare module '*?url' {
  const url: string
  export default url
}
