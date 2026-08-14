import { FileCode2, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentImagePreview } from '../../shared/files'
import './agentImage.css'

export function AgentImage({ alt, path, projectId, worktreeId }: {
  alt: string
  path: string
  projectId: string | null
  worktreeId: string | null
}): React.JSX.Element {
  const [preview, setPreview] = useState<AgentImagePreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setPreview(null)
    setLoadError(null)
    if (!projectId) {
      setLoadError('当前任务没有可用于验证图片路径的项目。')
      return () => { active = false }
    }
    void window.norevinq.previewAgentImage({ projectId, path, ...(worktreeId ? { worktreeId } : {}) })
      .then((value) => { if (active) setPreview(value) })
      .catch((reason: unknown) => { if (active) setLoadError(errorMessage(reason)) })
    return () => { active = false }
  }, [path, projectId, worktreeId])

  if (loadError) return <div className="agent-image-error" role="note"><FileCode2 size={14} /><span>图片无法安全预览：{loadError}</span></div>
  if (!preview) return <div className="agent-image-loading" role="status"><LoaderCircle size={14} className="spin" />正在验证本地图片…</div>
  return <figure className="agent-image">
    <img src={preview.url} alt={alt || preview.name} onError={() => setLoadError('图片读取失败或预览凭据已过期。')} />
    <figcaption>{alt || preview.name}</figcaption>
  </figure>
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
