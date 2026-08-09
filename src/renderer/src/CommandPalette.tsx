import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export type CommandAction = {
  id: string
  label: string
  detail: string
  shortcut?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

export function CommandPalette({ actions, close, onError }: {
  actions: CommandAction[]
  close: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? actions.filter((action) => `${action.label} ${action.detail}`.toLocaleLowerCase().includes(needle)) : actions
  }, [actions, query])

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1)) }, [filtered.length, selected])

  async function execute(action: CommandAction | undefined): Promise<void> {
    if (!action || action.disabled) return
    close()
    onError(null)
    try { await action.run() }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)) }
  }

  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <header><Search size={16} /><input ref={input} aria-label="搜索命令" placeholder="搜索操作、面板或外观…" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0) }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(filtered.length - 1, value + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); void execute(filtered[selected]) }
        else if (event.key === 'Escape') { event.preventDefault(); close() }
      }} /><button onClick={close} aria-label="关闭命令面板"><X size={14} /></button></header>
      <div role="listbox" aria-label="可用命令">{filtered.map((action, index) => <button role="option" aria-selected={selected === index} className={selected === index ? 'selected' : ''} disabled={action.disabled} key={action.id} onMouseEnter={() => setSelected(index)} onClick={() => void execute(action)}><span><strong>{action.label}</strong><small>{action.detail}</small></span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>)}{filtered.length === 0 && <p>没有匹配的命令</p>}</div>
      <footer><span>↑↓ 选择</span><span>↵ 执行</span><span>Esc 关闭</span></footer>
    </section>
  </div>
}
