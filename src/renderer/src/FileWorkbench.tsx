import {
  ChevronRight,
  ExternalLink,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/contracts'
import type { ManagedWorktree } from '../../shared/worktree'
import type { ProjectDirectory, ProjectFileEntry, ProjectFilePreview } from '../../shared/files'

export function FileWorkbench({ project, worktree, initialPath, close, onError }: {
  project: ProjectSummary
  worktree: ManagedWorktree | null
  initialPath: string | null
  close: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [directoryPath, setDirectoryPath] = useState(() => parentPath(initialPath ?? ''))
  const [directory, setDirectory] = useState<ProjectDirectory | null>(null)
  const [selected, setSelected] = useState<ProjectFilePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const context = { projectId: project.id, ...(worktree ? { worktreeId: worktree.id } : {}) }

  async function loadDirectory(path: string): Promise<void> {
    setLoading(true)
    onError(null)
    try {
      setDirectory(await window.norevinq.listProjectDirectory({ ...context, path }))
      setDirectoryPath(path)
    } catch (reason) {
      onError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  async function openFile(path: string): Promise<void> {
    setLoading(true)
    onError(null)
    try { setSelected(await window.norevinq.previewProjectFile({ ...context, path })) }
    catch (reason) { onError(errorMessage(reason)) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const firstDirectory = parentPath(initialPath ?? '')
    void loadDirectory(firstDirectory).then(() => {
      if (initialPath) return openFile(initialPath)
      return undefined
    })
  }, [project.id, worktree?.id, initialPath])

  async function openExternal(): Promise<void> {
    if (!selected || !window.confirm(`使用系统默认应用打开 ${selected.name}？`)) return
    onError(null)
    try { await window.norevinq.openProjectFileExternal({ ...context, path: selected.path, confirmed: true }) }
    catch (reason) { onError(errorMessage(reason)) }
  }

  const crumbs = directoryPath ? directoryPath.split('/') : []
  return <section className="file-workbench" aria-label="文件与产物">
    <header><div><p className="eyebrow">FILES & ARTIFACTS</p><h2>{worktree ? 'Worktree 文件' : project.name}</h2></div><button className="icon-button" onClick={close} aria-label="关闭文件预览"><X size={16} /></button></header>
    <div className="file-breadcrumbs"><button onClick={() => void loadDirectory('')}><FolderOpen size={13} />根目录</button>{crumbs.map((crumb, index) => {
      const path = crumbs.slice(0, index + 1).join('/')
      return <span key={path}><ChevronRight size={12} /><button onClick={() => void loadDirectory(path)}>{crumb}</button></span>
    })}<button className="file-refresh" onClick={() => void loadDirectory(directoryPath)} aria-label="刷新文件"><RefreshCw size={13} /></button></div>
    <div className="file-workbench-body">
      <aside className="file-list" aria-label="项目文件">
        {loading && !directory ? <div className="file-loading"><LoaderCircle className="spin" size={18} />正在读取…</div> : directory?.entries.map((entry) => <FileRow
          key={entry.path}
          entry={entry}
          selected={selected?.path === entry.path}
          open={() => entry.kind === 'directory' ? loadDirectory(entry.path) : entry.kind === 'file' ? openFile(entry.path) : Promise.resolve()}
        />)}
        {directory?.entries.length === 0 && <div className="file-loading">空目录</div>}
        {directory?.truncated && <p className="file-limit">目录超过 500 项，仅显示前 500 项。</p>}
      </aside>
      <main className="file-preview-pane">
        {!selected ? <div className="file-preview-empty"><FileText size={25} /><strong>选择文件进行预览</strong><p>文本、代码、图片、音频、视频和 PDF 会在受控预览器中打开。</p></div> : <>
          <div className="file-preview-header"><div><strong>{selected.name}</strong><span>{formatBytes(selected.size)} · {selected.mimeType}</span></div><button onClick={() => void openExternal()}><ExternalLink size={13} />系统打开</button></div>
          <FilePreview value={selected} />
        </>}
      </main>
    </div>
  </section>
}

function FileRow({ entry, selected, open }: { entry: ProjectFileEntry; selected: boolean; open: () => Promise<void> }): React.JSX.Element {
  const Icon = entry.kind === 'directory' ? Folder : entry.kind === 'symlink' ? File : iconFor(entry.previewKind)
  return <button className={`file-row ${selected ? 'selected' : ''}`} disabled={entry.kind === 'symlink'} onDoubleClick={() => void open()} onClick={() => void open()} title={entry.kind === 'symlink' ? '出于安全原因不遍历符号链接' : entry.path}><Icon size={15} /><span><strong>{entry.name}</strong><small>{entry.kind === 'file' && entry.size !== null ? formatBytes(entry.size) : entry.kind === 'symlink' ? '符号链接（不可预览）' : '目录'}</small></span>{entry.kind === 'directory' && <ChevronRight size={13} />}</button>
}

function FilePreview({ value }: { value: ProjectFilePreview }): React.JSX.Element {
  if (value.kind === 'text') return <div className="text-preview"><pre><code>{value.content}</code></pre>{value.truncated && <p>文件超过 2 MiB，仅显示开头部分。</p>}</div>
  if (value.kind === 'image' && value.url) return <div className="media-preview"><img src={value.url} alt={value.name} /></div>
  if (value.kind === 'audio' && value.url) return <div className="media-preview audio"><FileAudio size={36} /><audio src={value.url} controls /></div>
  if (value.kind === 'video' && value.url) return <div className="media-preview"><video src={value.url} controls /></div>
  if (value.kind === 'pdf' && value.url) return <iframe className="pdf-preview" src={value.url} title={`PDF ${value.name}`} />
  return <div className="file-preview-empty"><File size={25} /><strong>{value.kind === 'too-large' ? '文件超过安全预览上限' : '无法在应用内预览二进制文件'}</strong><p>可以在确认后使用系统默认应用打开。</p></div>
}

function iconFor(kind: ProjectFileEntry['previewKind']): typeof File {
  if (kind === 'image') return FileImage
  if (kind === 'audio') return FileAudio
  if (kind === 'video') return FileVideo
  if (kind === 'text') return FileCode2
  return File
}

function parentPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
