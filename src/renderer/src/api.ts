/** Typed access to the preload bridge. */
export const bc = window.bc

export const coverUrl = (id: string, v?: number | string) => `bc://cover/${id}${v ? `?v=${v}` : ''}`
export const bookUrl = (id: string) => `bc://book/${id}`

export async function readBookBytes(id: string): Promise<Uint8Array> {
  const res = await fetch(bookUrl(id))
  if (!res.ok) throw new Error(`Cannot read book (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function readBookFile(id: string, name: string): Promise<File> {
  const res = await fetch(bookUrl(id))
  if (!res.ok) throw new Error(`Cannot read book (${res.status})`)
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type })
}
