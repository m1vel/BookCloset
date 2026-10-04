import { useEffect, useRef, useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { useT } from '../i18n'
import { bc } from '../api'
import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { openBookById } from './open'

/** Window-wide drag & drop target for adding books. */
export function DropZone() {
  const t = useT()
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const paths = Array.from(e.dataTransfer?.files ?? []).map(f => bc.pathForFile(f)).filter(Boolean)
      if (!paths.length) return
      const records = await useLibrary.getState().importPaths(paths)
      // a single file dropped while reading (or on an empty library) opens immediately
      if (paths.length === 1 && records.length === 1 && useUi.getState().route.name === 'reader') openBookById(records[0].id)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!over) return null
  return (
    <div className="dropzone" aria-live="assertive">
      <div className="dropzone-card">
        <div className="dropzone-icon"><DownloadSimple size={34} weight="duotone" /></div>
        <div className="display dropzone-title">{t('lib.drop')}</div>
        <div className="muted">{t('lib.dropHint')}</div>
      </div>
    </div>
  )
}
