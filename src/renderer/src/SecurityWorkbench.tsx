import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileJson,
  FileSearch,
  FolderGit2,
  Gauge,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProjectSummary } from '../../shared/contracts'
import type {
  SecurityArtifact,
  SecurityDeepSeekModel,
  SecurityFinding,
  SecurityModelProvider,
  SecurityPreflight,
  SecurityScanMode,
  SecurityScanRecord,
  SecuritySnapshot,
  SecurityTargetKind,
} from '../../shared/security'

type SecurityTab = 'overview' | 'scans' | 'findings' | 'repositories' | 'settings'

export function SecurityWorkbench({ snapshot, project, close, onError }: {
  snapshot: SecuritySnapshot | null
  project: ProjectSummary | null
  close: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<SecurityTab>('overview')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<SecurityScanMode>('standard')
  const [target, setTarget] = useState<SecurityTargetKind>('repository')
  const [provider, setProvider] = useState<SecurityModelProvider>('openai')
  const [deepSeekModel, setDeepSeekModel] = useState<SecurityDeepSeekModel>('deepseek-v4-pro')
  const [auth, setAuth] = useState<'auto' | 'chatgpt' | 'api-key'>('auto')
  const [paths, setPaths] = useState('src')
  const [base, setBase] = useState('HEAD')
  const [maxCost, setMaxCost] = useState('5')
  const [preflight, setPreflight] = useState<SecurityPreflight | null>(null)
  const [artifact, setArtifact] = useState<SecurityArtifact | null>(null)
  const findings = useMemo(() => snapshot?.scans.flatMap((scan) => scan.result?.findings ?? []) ?? [], [snapshot])

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    onError(null)
    try { await action() } catch (reason) { onError(toErrorMessage(reason)) } finally { setBusy(false) }
  }

  const request = project ? {
    projectId: project.id,
    provider,
    ...(provider === 'deepseek' ? { model: deepSeekModel } : {}),
    mode,
    target: target === 'repository' ? { kind: 'repository' as const }
      : target === 'paths' ? { kind: 'paths' as const, paths: paths.split('\n').map((value) => value.trim()).filter(Boolean) }
        : target === 'working_tree' ? { kind: 'working_tree' as const, base }
          : { kind: 'refs' as const, base },
    auth,
    ...(provider === 'openai' && Number(maxCost) > 0 ? { maxCostUsd: Number(maxCost) } : {}),
    ...(mode === 'deep' ? { deep: { workers: 2, subagents: 0, stopAfterNoNew: 3, maxDiscoveryRuns: 10 } } : {}),
  } : null

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="settings-workbench security-workbench" role="dialog" aria-modal="true" aria-label="Aster 安全工作台">
      <header className="settings-workbench-header">
        <div><p className="eyebrow">ASTER SECURITY</p><h2>Aster 安全工作台</h2></div>
        <button className="icon-button" onClick={close} aria-label="关闭 Aster 安全工作台"><X size={16} /></button>
      </header>
      <nav className="settings-tabs" aria-label="安全类别">
        <button className={tab === 'overview' ? 'selected' : ''} onClick={() => setTab('overview')}><Gauge size={14} />总览</button>
        <button className={tab === 'scans' ? 'selected' : ''} onClick={() => setTab('scans')}><FileSearch size={14} />扫描</button>
        <button className={tab === 'findings' ? 'selected' : ''} onClick={() => setTab('findings')}><AlertTriangle size={14} />漏洞</button>
        <button className={tab === 'repositories' ? 'selected' : ''} onClick={() => setTab('repositories')}><FolderGit2 size={14} />仓库</button>
        <button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><Settings2 size={14} />设置</button>
      </nav>
      <div className="settings-workbench-body">
        {tab === 'overview' && <Overview snapshot={snapshot} findings={findings} busy={busy} refresh={() => run(() => window.aster.refreshSecurityRuntime())} />}
        {tab === 'scans' && <div className="settings-section">
          <div className="section-heading"><div><h3>运行扫描</h3><p>产物保存在仓库外的应用私有目录；真实扫描可能产生模型费用。</p></div></div>
          {!project ? <Empty title="尚未打开项目" detail="打开项目后才能预检或启动扫描。" /> : <div className="security-scan-form">
            <label><span>模型提供商</span><select value={provider} onChange={(event) => { setProvider(event.target.value as SecurityModelProvider); setPreflight(null) }}><option value="openai">OpenAI / ChatGPT</option><option value="deepseek">DeepSeek Responses</option></select></label>
            <label><span>模式</span><select value={mode} onChange={(event) => { const next = event.target.value as SecurityScanMode; setMode(next); if (next === 'deep' && (target === 'refs' || target === 'working_tree')) setTarget('repository') }}><option value="standard">普通扫描</option><option value="deep">深度扫描</option></select></label>
            <label><span>目标</span><select value={target} onChange={(event) => setTarget(event.target.value as SecurityTargetKind)}><option value="repository">完整仓库</option><option value="paths">指定路径</option>{mode === 'standard' && <><option value="working_tree">工作区差异</option><option value="refs">提交差异</option></>}</select></label>
            {provider === 'openai' ? <label><span>认证</span><select value={auth} onChange={(event) => setAuth(event.target.value as typeof auth)}><option value="auto">自动选择</option><option value="chatgpt">ChatGPT 登录</option><option value="api-key">环境 API Key</option></select></label> : <label><span>DeepSeek 模型</span><select value={deepSeekModel} onChange={(event) => setDeepSeekModel(event.target.value as SecurityDeepSeekModel)}><option value="deepseek-v4-pro">DeepSeek V4 Pro（并行验证）</option><option value="deepseek-v4-flash">DeepSeek V4 Flash（串行验证）</option></select></label>}
            {provider === 'openai' ? <label><span>费用上限（USD）</span><input type="number" min="0.01" step="0.01" value={maxCost} onChange={(event) => setMaxCost(event.target.value)} /></label> : <p className="settings-note">使用 DeepSeek API Key 直接计费；下方实时显示 token 与人民币估算。Flash 与 Pro 均已通过 Aster 0.1.0 的真实 completed + sealed 扫描。为避免产物收敛竞态，Flash 使用单线程审计，Pro 使用有限并行。SDK 暂不能对 DeepSeek 执行可靠美元硬中止。</p>}
            {target === 'paths' && <label className="wide"><span>仓库相对路径（每行一项）</span><textarea rows={3} value={paths} onChange={(event) => setPaths(event.target.value)} /></label>}
            {(target === 'working_tree' || target === 'refs') && <label className="wide"><span>基准引用</span><input value={base} onChange={(event) => setBase(event.target.value)} /></label>}
            {mode === 'deep' && <p className="settings-note wide">深度扫描采用 2 个发现 worker、0 个子智能体，连续 3 轮无新发现后停止，最多 10 轮。</p>}
            <div className="settings-actions wide"><button disabled={busy || !request || snapshot?.activeScanId !== null} onClick={() => void run(async () => { if (request) setPreflight(await window.aster.preflightSecurityScan(request)) })}><ShieldCheck size={13} />本地预检</button><button className="primary-button" disabled={busy || !request || snapshot?.activeScanId !== null} onClick={() => void run(async () => { if (request) { await window.aster.startSecurityScan(request); setPreflight(null) } })}><Play size={13} />启动真实扫描</button></div>
          </div>}
          {preflight && <div className="security-preflight"><CheckCircle2 size={16} /><div><strong>预检通过</strong><p>{preflight.modelProvider ?? 'openai'} · {preflight.model} · {preflight.reasoningEffort} · {preflight.authentication} · {preflight.outputIsolated ? '产物目录已隔离' : '产物目录异常'}</p></div></div>}
          <ScanList scans={snapshot?.scans ?? []} activeScanId={snapshot?.activeScanId ?? null} busy={busy} run={run} viewArtifact={setArtifact} />
        </div>}
        {tab === 'findings' && <Findings scans={snapshot?.scans ?? []} busy={busy} run={run} viewResult={setArtifact} />}
        {tab === 'repositories' && <Repositories scans={snapshot?.scans ?? []} />}
        {tab === 'settings' && <SecuritySettings snapshot={snapshot} busy={busy} refresh={() => run(() => window.aster.refreshSecurityRuntime())} />}
      </div>
      {artifact && <div className="security-artifact" aria-label="扫描产物预览"><header><strong>{artifact.kind.toUpperCase()}</strong>{artifact.truncated && <span>仅显示前 2 MiB</span>}<button className="icon-button" onClick={() => setArtifact(null)} aria-label="关闭产物"><X size={14} /></button></header><pre>{artifact.content}</pre></div>}
    </section>
  </div>
}

function Overview({ snapshot, findings, busy, refresh }: {
  snapshot: SecuritySnapshot | null
  findings: SecurityFinding[]
  busy: boolean
  refresh: () => Promise<void>
}): React.JSX.Element {
  const completed = snapshot?.scans.filter(({ status }) => status === 'completed').length ?? 0
  const high = findings.filter(({ severity }) => severity === 'critical' || severity === 'high').length
  return <div className="settings-section">
    <div className="section-heading"><div><h3>安全态势</h3><p>仅汇总真实完成并通过 SDK sealed contract 的扫描。</p></div><button disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} />诊断运行时</button></div>
    <div className="security-metrics"><article><ShieldCheck size={18} /><span>已完成扫描</span><strong>{completed}</strong></article><article><AlertTriangle size={18} /><span>高危及以上</span><strong>{high}</strong></article><article><Archive size={18} /><span>已记录漏洞</span><strong>{findings.length}</strong></article></div>
    <RuntimeCard snapshot={snapshot} />
    {snapshot?.scans[0] ? <ScanSummary scan={snapshot.scans[0]} /> : <Empty title="尚无扫描记录" detail="前往“扫描”页先执行本地预检，再按需启动真实扫描。" />}
  </div>
}

function RuntimeCard({ snapshot }: { snapshot: SecuritySnapshot | null }): React.JSX.Element {
  const runtime = snapshot?.runtime
  return <div className="security-runtime">
    <div><strong>SDK</strong><span>{runtime?.sdkVersion ?? '检测中'} · plugin {runtime?.bundledPluginVersion ?? '—'}</span></div>
    <div><strong>隔离安全引擎</strong><span>SDK {runtime?.codexSdkVersion ?? '—'} · executable {runtime?.codexExecutableVersion ?? '—'}</span></div>
    <div><strong>Python</strong><span>{runtime?.python.status === 'ready' ? runtime.python.executable : runtime?.python.message ?? '尚未诊断'}</span></div>
    <div><strong>账户 / Trusted Access</strong><span>{runtime?.account.details ?? runtime?.account.status ?? 'unknown'} · {runtime?.access ?? 'unknown'}</span></div>
    <div><strong>DeepSeek 安全扫描</strong><span>{runtime?.deepseek.configured ? `已配置 · ${runtime.deepseek.models.join(' / ')}` : '未配置 API Key'}</span></div>
  </div>
}

function ScanList({ scans, activeScanId, busy, run, viewArtifact }: {
  scans: SecurityScanRecord[]
  activeScanId: string | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  viewArtifact: (artifact: SecurityArtifact) => void
}): React.JSX.Element {
  if (scans.length === 0) return <Empty title="没有扫描历史" detail="本地预检不写入历史；启动真实扫描后会在此显示。" />
  return <div className="security-scan-list">{scans.map((scan) => <article key={scan.id}>
    <header><div><strong>{scan.projectName}</strong><span>{scan.request.provider ?? 'openai'}{scan.request.model ? `/${scan.request.model}` : ''} · {scan.request.mode} · {scan.request.target.kind} · {formatTime(scan.createdAt)}</span></div><i className={scan.status}>{scanStatus(scan.status)}</i></header>
    {scan.progress && <div className="security-progress"><div><span style={{ width: `${String(progressPercent(scan))}%` }} /></div><small>{scan.progress.phase} · {scan.progress.filesCompleted}/{scan.progress.filesTotal || '?'} 文件{scan.progress.costUsd === undefined ? '' : ` · $${scan.progress.costUsd.toFixed(4)}`}</small><p>{scan.progress.activity}</p></div>}
    {scan.progress?.deepseekUsage && <DeepSeekUsage usage={scan.progress.deepseekUsage} />}
    {scan.error && <div className="provider-warning"><strong>{scan.error.code}</strong><span>{scan.error.message}</span></div>}
    {scan.result && <ScanSummary scan={scan} />}
    <footer>{activeScanId === scan.id && <button className="danger-button" disabled={busy} onClick={() => void run(() => window.aster.cancelSecurityScan({ scanId: scan.id }))}><Square size={11} />取消</button>}{scan.result?.reportAvailable && <button disabled={busy} onClick={() => void run(async () => viewArtifact(await window.aster.readSecurityArtifact({ scanId: scan.id, kind: 'report' })))}><FileSearch size={11} />报告</button>}{scan.result && <button disabled={busy} onClick={() => void run(async () => { const value = await window.aster.exportSecurityFindings({ scanId: scan.id, format: 'json' }); viewArtifact({ kind: 'findings', content: value.content, truncated: value.truncated }) })}><FileJson size={11} />JSON</button>}{scan.result && <button disabled={busy} onClick={() => void run(async () => { const value = await window.aster.exportSecurityFindings({ scanId: scan.id, format: 'csv' }); viewArtifact({ kind: 'findings', content: value.content, truncated: value.truncated }) })}><FileJson size={11} />CSV</button>}{scan.result?.sarifAvailable && <button disabled={busy} onClick={() => void run(async () => viewArtifact(await window.aster.readSecurityArtifact({ scanId: scan.id, kind: 'sarif' })))}><FileJson size={11} />SARIF</button>}</footer>
  </article>)}</div>
}

function ScanSummary({ scan }: { scan: SecurityScanRecord }): React.JSX.Element {
  const result = scan.result
  if (!result) return <></>
  return <div className="scan-result-summary"><span>{result.findings.length} 个漏洞</span><span>覆盖：{result.coverage.completeness}</span><span>{result.coverage.surfaces} 个安全面</span><span>plugin {result.pluginVersion}</span></div>
}

function DeepSeekUsage({ usage }: { usage: NonNullable<NonNullable<SecurityScanRecord['progress']>['deepseekUsage']> }): React.JSX.Element {
  const hitRate = usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0
  return <div className="deepseek-usage" aria-label="DeepSeek 实时 Token 与费用">
    <div><span>输入</span><strong>{formatTokens(usage.inputTokens)}</strong><small>总计 {formatTokens(usage.totalTokens)}</small></div>
    <div><span>缓存命中</span><strong>{formatTokens(usage.cachedInputTokens)}</strong><small>{(hitRate * 100).toFixed(1)}%</small></div>
    <div><span>缓存未命中</span><strong>{formatTokens(usage.uncachedInputTokens)}</strong></div>
    <div><span>输出</span><strong>{formatTokens(usage.outputTokens)}</strong><small>推理 {formatTokens(usage.reasoningOutputTokens)}</small></div>
    <div className="cost"><span>预估消耗</span><strong>¥{usage.estimatedCny.toFixed(6)}</strong><small>${usage.estimatedUsd.toFixed(6)} · USD/CNY {usage.usdCnyRate.toFixed(4)}</small></div>
    <p>DeepSeek 官方 {pricingTier(usage.pricingTier)}价（{usage.pricingVersion}）· 汇率 {usage.exchangeRateDate}{usage.exchangeRateSource === 'fallback' ? ' 备用值' : ' ECB 参考' } · 实际账单以 DeepSeek 控制台为准</p>
  </div>
}

function Findings({ scans, busy, run, viewResult }: {
  scans: SecurityScanRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  viewResult: (artifact: SecurityArtifact) => void
}): React.JSX.Element {
  const entries = scans.flatMap((scan) => (scan.result?.findings ?? []).map((finding) => ({ scanId: scan.id, finding })))
  return <div className="settings-section"><div className="section-heading"><div><h3>漏洞</h3><p>证据、验证和攻击路径来自真实 sealed findings，不由界面补写。</p></div></div>{entries.length === 0 ? <Empty title="没有已验证漏洞" detail="完成扫描后，发现会按严重程度显示在此。" /> : <div className="security-findings">{entries.sort((a, b) => severityRank(a.finding.severity) - severityRank(b.finding.severity)).map(({ scanId, finding }) => <details key={`${scanId}:${finding.occurrenceId}`}><summary><span className={`severity ${finding.severity}`}>{finding.severity}</span><strong>{finding.title}</strong><small>{finding.locations[0] ? `${finding.locations[0].path}:${String(finding.locations[0].startLine)}` : finding.ruleId}</small></summary><p>{finding.summary}</p><dl><dt>置信度</dt><dd>{finding.confidence}</dd><dt>分类</dt><dd>{finding.category} · {finding.cwe.join(', ')}</dd><dt>修复</dt><dd>{finding.remediation}</dd><dt>验证</dt><dd>{finding.validation ? '包含验证证据' : '未提供'}</dd><dt>攻击路径</dt><dd>{finding.attackPath ? '包含攻击路径' : '未提供'}</dd></dl>{finding.evidence.map((evidence) => <pre key={`${evidence.path}:${String(evidence.startLine)}`}>{evidence.code}</pre>)}<div className="finding-actions"><button disabled={busy} onClick={() => void run(async () => { const value = await window.aster.runSecurityFindingAction({ scanId, occurrenceId: finding.occurrenceId, action: 'validate', confirmed: true }); viewResult({ kind: 'findings', content: value.output, truncated: value.truncated }) })}>验证</button><button disabled={busy} onClick={() => { if (window.confirm('修复会让 Aster 安全工作台修改当前仓库文件。是否继续？')) void run(async () => { const value = await window.aster.runSecurityFindingAction({ scanId, occurrenceId: finding.occurrenceId, action: 'patch', confirmed: true }); viewResult({ kind: 'findings', content: value.output, truncated: value.truncated }) }) }}>修复</button><button disabled={busy} onClick={() => { const reason = window.prompt('请输入标记误报的原因'); if (reason?.trim()) void run(async () => { const value = await window.aster.runSecurityFindingAction({ scanId, occurrenceId: finding.occurrenceId, action: 'false_positive', reason: reason.trim(), confirmed: true }); viewResult({ kind: 'findings', content: value.output, truncated: value.truncated }) }) }}>标记误报</button></div></details>)}</div>}</div>
}

function Repositories({ scans }: { scans: SecurityScanRecord[] }): React.JSX.Element {
  const repositories = new Map<string, SecurityScanRecord[]>()
  for (const scan of scans) repositories.set(scan.projectPath, [...(repositories.get(scan.projectPath) ?? []), scan])
  return <div className="settings-section"><div className="section-heading"><div><h3>仓库</h3><p>按真实扫描记录聚合，不主动全盘发现本地仓库。</p></div></div>{repositories.size === 0 ? <Empty title="没有已扫描仓库" detail="完成一次扫描后会建立仓库安全历史。" /> : <div className="security-repositories">{[...repositories].map(([path, items]) => <article key={path}><FolderGit2 size={17} /><div><strong>{items[0]?.projectName}</strong><span title={path}>{path}</span></div><b>{items.length} 次扫描</b></article>)}</div>}</div>
}

function SecuritySettings({ snapshot, busy, refresh }: { snapshot: SecuritySnapshot | null; busy: boolean; refresh: () => Promise<void> }): React.JSX.Element {
  return <div className="settings-section"><div className="section-heading"><div><h3>运行时与权限</h3><p>安全扫描引擎与主智能体引擎版本隔离，避免依赖漂移。</p></div><button disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} />重新检测</button></div><RuntimeCard snapshot={snapshot} /><div className="provider-warning"><strong>账户权限边界</strong><span>已登录不代表自动拥有 Security 或 Trusted Access。授权状态只有真实扫描事件能够确认，界面不会静默推断。</span></div><div className="security-policy"><strong>产物安全策略</strong><ul><li>扫描输出位于工作树之外，目录权限为 0700。</li><li>报告读取限制为已完成扫描的固定文件，拒绝符号链接越界。</li><li>预览最多 2 MiB；密钥、令牌和认证头不会写入扫描历史。</li></ul></div></div>
}

function Empty({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return <div className="settings-empty"><ShieldCheck size={20} /><strong>{title}</strong><p>{detail}</p></div>
}

function progressPercent(scan: SecurityScanRecord): number {
  const progress = scan.progress
  if (!progress) return 0
  if (scan.status === 'completed') return 100
  if (progress.filesTotal <= 0) return scan.status === 'running' ? 8 : 0
  return Math.max(0, Math.min(100, Math.round(progress.filesCompleted / progress.filesTotal * 100)))
}

function scanStatus(status: SecurityScanRecord['status']): string {
  return { queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' }[status]
}

function severityRank(severity: SecurityFinding['severity']): number {
  return ['critical', 'high', 'medium', 'low', 'informational'].indexOf(severity)
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function pricingTier(value: 'current' | 'peak' | 'off_peak'): string {
  return { current: '当前', peak: '高峰', off_peak: '非高峰' }[value]
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
