import {
  Check,
  Download,
  FileArchive,
  ExternalLink,
  FileText,
  KeyRound,
  Layers3,
  LoaderCircle,
  Network,
  PackageOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { ProjectSummary } from '../../shared/contracts'
import type {
  IntegrationJson,
  IntegrationSnapshot,
  McpResourceReadResult,
  McpToolCallResult,
  SafeConfigKey,
} from '../../shared/integrations'
import type { ProviderStatus } from '../../shared/providers'
import type { CodexRuntimeSnapshot } from '../../shared/runtime'
import type { UpdateSnapshot } from '../../shared/update'
import type { DiagnosticsSnapshot } from '../../shared/diagnostics'

type SettingsTab = 'providers' | 'mcp' | 'skills' | 'config' | 'app'

export function SettingsWorkbench({
  providers,
  apiKey,
  setApiKey,
  project,
  threadId,
  integrations,
  updates,
  diagnostics,
  close,
  onError,
  onUpdated,
  onUpdate,
  onDiagnostics,
}: {
  providers: ProviderStatus | null
  apiKey: string
  setApiKey: (value: string) => void
  project: ProjectSummary | null
  threadId: string | null
  integrations: IntegrationSnapshot | null
  updates: UpdateSnapshot | null
  diagnostics: DiagnosticsSnapshot | null
  close: () => void
  onError: (message: string | null) => void
  onUpdated: (result: { providers: ProviderStatus; runtime: CodexRuntimeSnapshot }) => void
  onUpdate: (snapshot: UpdateSnapshot) => void
  onDiagnostics: (snapshot: DiagnosticsSnapshot) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('providers')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    onError(null)
    try { await action() } catch (reason) { onError(toErrorMessage(reason)) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="settings-workbench" role="dialog" aria-modal="true" aria-label="设置工作台">
      <header className="settings-workbench-header">
        <div><p className="eyebrow">ASTER CODE SETTINGS</p><h2>设置与集成</h2></div>
        <button className="icon-button" onClick={close} aria-label="关闭设置"><X size={16} /></button>
      </header>
      <nav className="settings-tabs" aria-label="设置类别">
        <button className={tab === 'providers' ? 'selected' : ''} onClick={() => setTab('providers')}><KeyRound size={14} />提供商</button>
        <button className={tab === 'mcp' ? 'selected' : ''} onClick={() => setTab('mcp')}><Network size={14} />MCP</button>
        <button className={tab === 'skills' ? 'selected' : ''} onClick={() => setTab('skills')}><PackageOpen size={14} />技能</button>
        <button className={tab === 'config' ? 'selected' : ''} onClick={() => setTab('config')}><Layers3 size={14} />配置</button>
        <button className={tab === 'app' ? 'selected' : ''} onClick={() => setTab('app')}><Download size={14} />应用</button>
      </nav>
      <div className="settings-workbench-body">
        {tab === 'providers' && <ProviderTab
          providers={providers}
          apiKey={apiKey}
          setApiKey={setApiKey}
          busy={busy}
          run={run}
          onUpdated={onUpdated}
        />}
        {tab === 'mcp' && <McpTab
          project={project}
          threadId={threadId}
          snapshot={integrations}
          busy={busy}
          run={run}
        />}
        {tab === 'skills' && <SkillsTab project={project} snapshot={integrations} busy={busy} run={run} />}
        {tab === 'config' && <ConfigTab project={project} snapshot={integrations} busy={busy} run={run} />}
        {tab === 'app' && <ApplicationTab snapshot={updates} diagnostics={diagnostics} busy={busy} run={run} onUpdate={onUpdate} onDiagnostics={onDiagnostics} />}
      </div>
    </section>
  </div>
}

function ApplicationTab({ snapshot, diagnostics, busy, run, onUpdate, onDiagnostics }: {
  snapshot: UpdateSnapshot | null
  diagnostics: DiagnosticsSnapshot | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  onUpdate: (snapshot: UpdateSnapshot) => void
  onDiagnostics: (snapshot: DiagnosticsSnapshot) => void
}): React.JSX.Element {
  const [exportedFile, setExportedFile] = useState<string | null>(null)
  const phaseLabel = snapshot ? updatePhaseLabel(snapshot.phase) : '正在读取'
  const canCheck = snapshot?.phase === 'idle' || snapshot?.phase === 'upToDate' || snapshot?.phase === 'error'
  return <div className="settings-section">
    <div className="section-heading"><div><h3>应用更新</h3><p>由签名发布包中的 electron-builder 更新元数据驱动。</p></div>{canCheck && <button disabled={busy} onClick={() => void run(async () => onUpdate(await window.aster.checkForUpdates()))}><RefreshCw size={13} />检查更新</button>}</div>
    <div className="provider-state">
      <div className="provider-icon"><Download size={17} /></div>
      <div><strong>{phaseLabel}</strong><p>当前版本 {snapshot?.currentVersion ?? '—'}{snapshot?.availableVersion ? ` · 可用 ${snapshot.availableVersion}` : ''}</p></div>
      <span className={snapshot?.phase === 'downloaded' || snapshot?.phase === 'upToDate' ? 'connected' : ''}>{snapshot?.configured ? '已配置渠道' : '无发布渠道'}</span>
    </div>
    {snapshot?.disabledReason && <div className="provider-warning"><strong>自动更新未启用</strong><span>{snapshot.disabledReason}</span></div>}
    {snapshot?.error && <div className="provider-warning"><strong>更新失败</strong><span>{snapshot.error}</span></div>}
    {snapshot?.phase === 'downloading' && <div className="update-progress"><progress max={100} value={snapshot.progress?.percent ?? 0} /><span>{(snapshot.progress?.percent ?? 0).toFixed(1)}%{snapshot.progress ? ` · ${formatBytes(snapshot.progress.transferred)} / ${formatBytes(snapshot.progress.total)}` : ''}</span></div>}
    {snapshot?.releaseNotes && <details className="result-preview" open><summary>版本说明</summary><pre>{snapshot.releaseNotes}</pre></details>}
    <p className="settings-note">已配置的正式包会在启动 30 秒后检查，并每 6 小时重试。发现版本后由你确认下载；SHA-512 与平台代码签名由 electron-updater 验证。下载完成后可立即重启安装，也会在正常退出时自动安装。</p>
    <div className="settings-actions">
      {snapshot?.phase === 'available' && <button className="primary-button" disabled={busy} onClick={() => void run(async () => onUpdate(await window.aster.downloadUpdate()))}><Download size={13} />下载 {snapshot.availableVersion}</button>}
      {snapshot?.phase === 'downloaded' && <button className="primary-button" disabled={busy} onClick={() => void run(() => window.aster.installUpdate())}><RefreshCw size={13} />重启并安装</button>}
    </div>
    <div className="section-heading diagnostic-heading"><div><h3>诊断与崩溃</h3><p>本地保留 {diagnostics?.retainedCrashCount ?? 0} 条崩溃记录，不会自动上传。</p></div></div>
    <div className="provider-state">
      <div className="provider-icon"><FileArchive size={17} /></div>
      <div><strong>{diagnostics?.latestCrashAt ? '已记录最近崩溃' : '没有崩溃记录'}</strong><p>{diagnostics?.runtimeLogAvailable ? '可附加最近 1 MiB 运行日志' : '当前没有运行日志'}</p></div>
      <span>{diagnostics?.automaticUpload === false ? '本地优先' : '—'}</span>
    </div>
    <p className="settings-note">导出 ZIP 仅包含版本/平台摘要、有界崩溃元数据和二次脱敏日志；不包含对话正文、项目文件、密钥或绝对路径。保存后由你自行检查和分享。</p>
    {exportedFile && <div className="provider-warning"><strong>诊断包已导出</strong><span>{exportedFile}</span></div>}
    <div className="settings-actions"><button disabled={busy} onClick={() => void run(async () => {
      const result = await window.aster.exportDiagnostics()
      if (result.exported) setExportedFile(`${result.fileName ?? '诊断包'} · ${formatBytes(result.bytes)}`)
      onDiagnostics(await window.aster.getDiagnosticsState())
    })}><FileArchive size={13} />导出诊断包</button></div>
  </div>
}

function updatePhaseLabel(phase: UpdateSnapshot['phase']): string {
  const labels: Record<UpdateSnapshot['phase'], string> = {
    disabled: '更新不可用',
    idle: '等待检查',
    checking: '正在检查更新',
    available: '发现新版本',
    downloading: '正在下载更新',
    downloaded: '更新已就绪',
    upToDate: '已是最新版本',
    error: '检查失败',
  }
  return labels[phase]
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${String(Math.round(value))} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function ProviderTab({ providers, apiKey, setApiKey, busy, run, onUpdated }: {
  providers: ProviderStatus | null
  apiKey: string
  setApiKey: (value: string) => void
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  onUpdated: (result: { providers: ProviderStatus; runtime: CodexRuntimeSnapshot }) => void
}): React.JSX.Element {
  const status = providers?.deepseek
  return <div className="settings-section">
    <div className="section-heading"><div><h3>DeepSeek Responses</h3><p>一级模型提供商，通过 Codex Responses wire API 工作。</p></div></div>
    <div className="provider-state">
      <div className="provider-icon"><KeyRound size={17} /></div>
      <div><strong>{status?.configured ? '已配置' : '未配置'}</strong><p>{status?.credentialSource === 'environment' ? '由进程环境安全提供' : status?.credentialSource === 'os-vault' ? '保存在操作系统加密保险库' : '添加 API Key 以启用'}</p></div>
      <span className={status?.configured ? 'connected' : ''}>{status?.responsesModel ?? 'deepseek-v4-flash'}</span>
    </div>
    <label className="credential-field"><span>API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="仅加密保存，不写入日志或数据库" /></label>
    <p className="settings-note">支持文本、推理、函数工具、custom apply_patch 与服务端 Web Search。不支持图片、文件输入、MCP、Computer Use、后台任务或 stateful Responses。</p>
    <div className="provider-warning"><strong>DeepSeek V4 Pro 暂不可用</strong><span>截至 2026-08-10，Responses API 返回 HTTP 400；Aster 不会静默降级到 Chat Completions。</span></div>
    <div className="settings-actions">
      {status?.credentialSource === 'os-vault' && <button onClick={() => void run(async () => onUpdated(await window.aster.deleteDeepSeekCredential()))} disabled={busy}>删除已保存密钥</button>}
      <button className="primary-button" onClick={() => void run(async () => {
        const result = await window.aster.saveDeepSeekCredential({ apiKey })
        setApiKey('')
        onUpdated(result)
      })} disabled={busy || apiKey.trim().length < 16}>{busy ? '正在重启运行时…' : '安全保存并启用'}</button>
    </div>
  </div>
}

function McpTab({ project, threadId, snapshot, busy, run }: {
  project: ProjectSummary | null
  threadId: string | null
  snapshot: IntegrationSnapshot | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const [serverName, setServerName] = useState('')
  const [toolName, setToolName] = useState('')
  const [argumentsJson, setArgumentsJson] = useState('{}')
  const [confirmed, setConfirmed] = useState(false)
  const [toolResult, setToolResult] = useState<McpToolCallResult | null>(null)
  const [resourceResult, setResourceResult] = useState<McpResourceReadResult | null>(null)
  const server = snapshot?.mcpServers.find(({ name }) => name === serverName) ?? snapshot?.mcpServers[0] ?? null
  const tool = server?.tools.find(({ name }) => name === toolName) ?? server?.tools[0] ?? null

  if (!project) return <EmptySettings title="尚未打开项目" detail="打开项目后可查看其有效 MCP 配置。" />
  return <div className="settings-section">
    <div className="section-heading"><div><h3>MCP 服务器</h3><p>状态、OAuth、资源和直接工具诊断均由 app-server 提供。</p></div><button disabled={busy} onClick={() => void run(() => window.aster.reloadMcpServers({ projectId: project.id }))}><RefreshCw size={13} />重载</button></div>
    {snapshot?.loading ? <Loading /> : snapshot?.mcpServers.length === 0 ? <EmptySettings title="未配置 MCP" detail="在 Codex 用户配置中添加 MCP 服务器后重载。" /> : <div className="integration-grid">
      <aside>{snapshot?.mcpServers.map((item) => <button key={item.name} className={item.name === server?.name ? 'selected' : ''} onClick={() => { setServerName(item.name); setToolName(''); setToolResult(null); setResourceResult(null) }}><Network size={13} /><span><strong>{item.title ?? item.name}</strong><small>{item.tools.length} 工具 · {item.resources.length} 资源</small></span><i className={item.authStatus === 'oAuth' || item.authStatus === 'bearerToken' ? 'connected' : ''} /></button>)}</aside>
      {server && <div className="integration-detail">
        <div className="integration-title"><div><strong>{server.title ?? server.name}</strong><small>{server.version ?? '版本未报告'} · {server.authStatus}</small></div>{server.authStatus === 'notLoggedIn' && <button disabled={busy} onClick={() => void run(async () => {
          const result = await window.aster.startMcpOAuth({ projectId: project.id, name: server.name, ...(threadId ? { threadId } : {}) })
          window.open(result.authorizationUrl, '_blank')
        })}><ExternalLink size={12} />登录</button>}</div>
        <h4>工具</h4>
        {server.tools.length === 0 ? <p className="integration-empty">此服务器没有公开工具。</p> : <>
          <select aria-label="MCP 工具" value={tool?.name ?? ''} onChange={(event) => { setToolName(event.target.value); setToolResult(null) }}>{server.tools.map((item) => <option key={item.name} value={item.name}>{item.title ?? item.name}</option>)}</select>
          <p className="tool-description">{tool?.description ?? '未提供描述'}</p>
          <textarea aria-label="MCP 工具参数 JSON" rows={4} value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} />
          <label className="confirm-tool"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我确认这是直接工具调用，可能产生外部副作用。</label>
          <button className="primary-button inline" disabled={busy || !threadId || !tool || !confirmed} onClick={() => void run(async () => {
            const result = await window.aster.callMcpTool({
              projectId: project.id,
              threadId: threadId ?? '',
              server: server.name,
              tool: tool?.name ?? '',
              arguments: JSON.parse(argumentsJson) as IntegrationJson,
              confirmed,
            })
            setToolResult(result)
          })}><Wrench size={12} />执行诊断调用</button>
          {!threadId && <p className="settings-note">选择一个任务后才能直接调用工具。</p>}
          {toolResult && <ResultPreview label={toolResult.isError ? '工具返回错误' : '工具结果'} value={toolResult} />}
        </>}
        <h4>资源</h4>
        {server.resources.length === 0 ? <p className="integration-empty">此服务器没有静态资源。</p> : <div className="resource-list">{server.resources.map((resource) => <button key={resource.uri} disabled={busy} title={resource.uri} onClick={() => void run(async () => {
          setResourceResult(await window.aster.readMcpResource({ projectId: project.id, name: server.name, uri: resource.uri, ...(threadId ? { threadId } : {}) }))
        })}><FileText size={12} /><span>{resource.title ?? resource.name}</span></button>)}</div>}
        {resourceResult && <ResultPreview label="资源内容" value={resourceResult} />}
      </div>}
    </div>}
  </div>
}

function SkillsTab({ project, snapshot, busy, run }: {
  project: ProjectSummary | null
  snapshot: IntegrationSnapshot | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  if (!project) return <EmptySettings title="尚未打开项目" detail="打开项目后可发现用户、仓库、系统与管理员技能。" />
  return <div className="settings-section">
    <div className="section-heading"><div><h3>技能</h3><p>app-server 发现的真实技能；文件变化会自动刷新。</p></div><button disabled={busy} onClick={() => void run(() => window.aster.refreshIntegrations())}><RefreshCw size={13} />刷新</button></div>
    <div className={`trust-banner ${snapshot?.trusted ? 'trusted' : ''}`}><ShieldCheck size={16} /><div><strong>{snapshot?.trusted ? '项目已信任' : '项目未信任'}</strong><p>信任后才可添加进程级外部技能根目录；项目技能仍按 Codex 规则展示。</p></div><button disabled={busy} onClick={() => void run(() => window.aster.setProjectTrust({ projectId: project.id, trusted: !snapshot?.trusted }))}>{snapshot?.trusted ? '撤销信任' : '信任项目'}</button></div>
    <div className="extra-roots"><div><strong>额外技能目录</strong><small>只在当前 app-server 进程有效，不写入项目。</small></div><button disabled={busy || !snapshot?.trusted} onClick={() => void run(() => window.aster.chooseExtraSkillRoot({ projectId: project.id }))}><Plus size={12} />添加</button></div>
    {snapshot?.extraSkillRoots.map((root) => <div className="root-row" key={root}><code>{root}</code><button disabled={busy} onClick={() => void run(() => window.aster.removeExtraSkillRoot({ projectId: project.id, path: root }))}><Trash2 size={12} /></button></div>)}
    <div className="skill-list">{snapshot?.skills.map((skill) => <article key={skill.path}>
      <div><strong>{skill.displayName}</strong><span>{skill.scope}</span></div><p>{skill.shortDescription ?? skill.description}</p><small title={skill.path}>{skill.path}</small>
      <button className={skill.enabled ? 'enabled' : ''} disabled={busy} onClick={() => void run(() => window.aster.setSkillEnabled({ projectId: project.id, path: skill.path, enabled: !skill.enabled }))}>{skill.enabled ? <><Check size={12} />已启用</> : '已停用'}</button>
    </article>)}</div>
    {snapshot?.skills.length === 0 && <EmptySettings title="没有发现技能" detail="可在用户或仓库技能目录创建 SKILL.md。" />}
    {snapshot?.skillErrors.map((error) => <div className="provider-warning" key={`${error.path ?? ''}:${error.message}`}><strong>技能加载失败</strong><span>{error.path ? `${error.path}: ` : ''}{error.message}</span></div>)}
  </div>
}

function ConfigTab({ project, snapshot, busy, run }: {
  project: ProjectSummary | null
  snapshot: IntegrationSnapshot | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const config = snapshot?.config
  if (!project) return <EmptySettings title="尚未打开项目" detail="打开项目后可解析用户、项目、系统与托管配置层。" />
  const write = (key: SafeConfigKey, value: string): Promise<void> => run(() => window.aster.writeSafeConfig({ projectId: project.id, key, value }))
  return <div className="settings-section">
    <div className="section-heading"><div><h3>有效配置</h3><p>结构化写入用户 config.toml；托管要求和覆盖状态保持可见。</p></div><button disabled={busy} onClick={() => void run(() => window.aster.refreshIntegrations())}><RefreshCw size={13} />刷新</button></div>
    <div className="config-grid">
      <ConfigSelect label="审批策略" value={config?.approvalPolicy} values={['untrusted', 'on-failure', 'on-request', 'never']} disabled={busy} onChange={(value) => write('approval_policy', value)} />
      <ConfigSelect label="沙箱" value={config?.sandboxMode} values={['read-only', 'workspace-write', 'danger-full-access']} disabled={busy} onChange={(value) => write('sandbox_mode', value)} />
      <ConfigSelect label="网络搜索" value={config?.webSearch} values={['disabled', 'cached', 'live']} disabled={busy} onChange={(value) => write('web_search', value)} />
      <ConfigSelect label="推理强度" value={config?.reasoningEffort} values={['minimal', 'low', 'medium', 'high', 'xhigh']} disabled={busy} onChange={(value) => write('model_reasoning_effort', value)} />
      <ConfigSelect label="输出详细度" value={null} values={['low', 'medium', 'high']} disabled={busy} onChange={(value) => write('model_verbosity', value)} />
    </div>
    <h4>项目指令</h4>
    {snapshot?.instructions.length ? snapshot.instructions.map((instruction) => <details className="config-layer" key={instruction.path}><summary><FileText size={12} />{instruction.path}<span>{instruction.bytes} bytes</span></summary><pre>{instruction.preview}</pre></details>) : <p className="integration-empty">项目根目录没有 AGENTS.md 或 AGENTS.override.md；Codex 仍会按其层级规则寻找指令。</p>}
    <h4>配置层</h4>
    {config?.layers.map((layer) => <details className="config-layer" key={`${layer.kind}:${layer.label}:${layer.version}`}><summary><Layers3 size={12} />{layer.kind}<span title={layer.label}>{layer.label}</span></summary><pre>{formatJson(layer.config)}</pre>{layer.disabledReason && <p>{layer.disabledReason}</p>}</details>)}
    <h4>托管要求</h4>
    <ResultPreview label={config?.requirements ? '当前要求' : '未配置企业要求'} value={config?.requirements ?? {}} />
  </div>
}

function ConfigSelect({ label, value, values, disabled, onChange }: {
  label: string
  value: string | null | undefined
  values: string[]
  disabled: boolean
  onChange: (value: string) => Promise<void>
}): React.JSX.Element {
  return <label><span>{label}</span><select disabled={disabled} value={value ?? ''} onChange={(event) => void onChange(event.target.value)}><option value="" disabled>未设置</option>{values.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
}

function ResultPreview({ label, value }: { label: string; value: unknown }): React.JSX.Element {
  return <details className="result-preview" open><summary>{label}</summary><pre>{formatJson(value)}</pre></details>
}

function EmptySettings({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return <div className="settings-empty"><PackageOpen size={20} /><strong>{title}</strong><p>{detail}</p></div>
}

function Loading(): React.JSX.Element {
  return <div className="settings-empty"><LoaderCircle className="spin" size={20} /><strong>正在读取 app-server 状态</strong></div>
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
