import { useEffect, useMemo, useRef, useState } from 'react'
import { projectApi } from './api'
import { projectLink } from './projectWorkflow'
import type { Baseline, Difference, ObjectLink, ObjectTarget, ProjectOverview, Review, TraceResult } from './projectWorkflow'
import type { ModelSnapshot, ValidationReport } from './types'
import { buildModelReportHtml } from './report'
import { isExtensionId } from './extensionIds'

export type ProjectSection = 'review' | 'trace' | 'baseline' | 'members'
const SECTIONS: [ProjectSection, string][] = [['review', '对象与评审'], ['trace', '需求追溯'], ['baseline', '基线与报告'], ['members', '项目成员']]
const ROLES: Record<string, string> = { owner: '负责人', editor: '建模人', reviewer: '评审人', viewer: '只读人' }
const RELATIONS = ['satisfy', 'verify', 'deriveReqt', 'refine', 'trace', 'allocate', 'dependency']
const RESULTS = { pass: '通过', fail: '未通过', missing: '缺测试结果' }

export function ProjectPanel({ project, name, model, target, link, overview, validation, section: initialSection,
  onClose, onLocate, onRefresh }: {
  project: string
  name: string
  model: ModelSnapshot
  target?: ObjectTarget
  link?: ObjectLink
  overview: ProjectOverview | null
  validation: ValidationReport | null
  section: ProjectSection
  onClose: () => void
  onLocate: (target: ObjectTarget) => void
  onRefresh: (model?: boolean) => Promise<unknown>
}) {
  const api = useMemo(() => projectApi(project), [project])
  const [section, setSection] = useState(initialSection)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [threadText, setThreadText] = useState('')
  const [replyText, setReplyText] = useState('')
  const [activeThread, setActiveThread] = useState('')
  const [reviewFilter, setReviewFilter] = useState('open')
  const [member, setMember] = useState('')
  const [role, setRole] = useState('reviewer')
  const [traceId, setTraceId] = useState(target?.type === 'element' ? target.id : '')
  const [traceDepth, setTraceDepth] = useState(3)
  const [direction, setDirection] = useState('both')
  const [relations, setRelations] = useState<string[]>(['satisfy', 'verify', 'deriveReqt', 'refine', 'trace'])
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [requirement, setRequirement] = useState(target?.type === 'element' ? target.id : '')
  const [test, setTest] = useState('')
  const [result, setResult] = useState<'pass' | 'fail'>('pass')
  const [source, setSource] = useState('')
  const [baselineName, setBaselineName] = useState('')
  const [notes, setNotes] = useState('')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [baselineTarget, setBaselineTarget] = useState<ObjectTarget | undefined>(link?.target)
  const [compareTo, setCompareTo] = useState('')
  const [differences, setDifferences] = useState<Difference[] | null>(null)
  const [report, setReport] = useState('')
  const [restore, setRestore] = useState(false)
  const reportFrame = useRef<HTMLIFrameElement>(null)
  const elements = useMemo(() => new Map(model.elements.map(item => [item.id, item])), [model.elements])
  const grant = overview?.grant

  useEffect(() => {
    if (!link?.baseline) return
    let active = true
    void api.baseline(link.baseline).then(value => {
      if (active) setBaseline(value)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [api, link?.baseline])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const locate = (item: ObjectTarget, version?: string) => {
    if (version) {
      setSection('baseline')
      setBaselineTarget(item)
      setCompareTo('')
      setDifferences(null)
      setReport('')
      void run(async () => { setBaseline(await api.baseline(version)) })
    } else {
      onLocate(item)
    }
  }

  const openBaseline = async (id: string) => {
    setReport('')
    setDifferences(null)
    setCompareTo('')
    setBaselineTarget(undefined)
    setRestore(false)
    setBaseline(id ? await api.baseline(id) : null)
  }

  const saveResult = () => run(async () => {
    await api.recordEvidence({ revision: model.revision, requirementId: requirement, testId: test, result, source })
    setSource('')
    setNotice('测试结果已登记')
    await onRefresh()
  })

  const changeThread = (id: string, operation: string) => run(async () => {
    await api.reply(id, operation, operation === 'reply' ? replyText : '')
    if (operation === 'reply') { setReplyText(''); setActiveThread('') }
    await onRefresh()
  })

  const targetValue = (snapshot: ModelSnapshot, item: ObjectTarget | undefined) => {
    if (!item) return undefined
    if (item.type === 'element') return snapshot.elements.find(object => object.id === item.id)
    if (item.type === 'diagram') return snapshot.diagrams.find(object => object.id === item.id)
    return snapshot.relationships.find(object => object.id === item.id)
  }

  const describe = (snapshot: ModelSnapshot, item: ObjectTarget, version?: string) => {
    const object = targetValue(snapshot, item)
    if (!object) return <p>该对象在此版本中已移除或不可用。</p>
    const type = 'type' in object ? object.type : object.kind
    return <div className="project-object">
      <strong>{object.name || item.label || type}</strong><span>{type} · <code>{object.id}</code></span>
      {'documentation' in object && object.documentation && <p>{object.documentation}</p>}
      {'properties' in object && object.properties && Object.keys(object.properties).length > 0 && <details><summary>属性</summary>
        <dl>{Object.entries(object.properties).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>
      </details>}
      {'elementIds' in object && <details><summary>图内元素（{object.elementIds.length}）</summary><ul>{object.elementIds.map(id =>
        <li key={id}><button type="button" onClick={() => version ? setBaselineTarget({ id, type: 'element' }) : locate({ id, type: 'element' })}>
          {snapshot.elements.find(element => element.id === id)?.name ?? id}</button></li>)}</ul></details>}
      <div className="project-actions"><label className="project-link">对象链接<input readOnly value={projectLink(project, item, version)}
        onFocus={event => event.currentTarget.select()} /></label>
        {!version && <button type="button" onClick={() => locate(item)}>在模型中定位</button>}
      </div>
    </div>
  }

  const threads = (items: Review[], readOnly = false) => items.length === 0 ? <p className="project-muted">没有匹配的批注。</p> : <ul className="project-threads">
    {items.map(thread => {
      const existing = targetValue(readOnly && baseline ? baseline.snapshot : model, thread.target)
      const archived = !existing && overview?.baselines.find(item => item.revision === thread.revision)
      return <li key={thread.id}>
        <div className="project-actions"><strong>{thread.target.label ?? thread.target.id}</strong>
          <span>{thread.status === 'open' ? '待处理' : '已解决'} · rev {thread.revision}</span>
          {existing ? <button type="button" onClick={() => readOnly ? setBaselineTarget(thread.target) : locate(thread.target)}>定位</button>
            : archived ? <button type="button" onClick={() => locate(thread.target, archived.id)}>打开评审版本</button>
              : <span className="project-muted">对象已移除</span>}</div>
        {thread.messages.map((message, index) => <div key={index} className="project-message"><small>{message.authorName} · {new Date(message.at).toLocaleString()}</small><p>{message.text}</p></div>)}
        {!readOnly && grant?.canReview && <div className="project-actions">
          <button type="button" disabled={busy} onClick={() => { setActiveThread(thread.id); setReplyText('') }}>回复</button>
          <button type="button" disabled={busy} onClick={() => void changeThread(thread.id, thread.status === 'open' ? 'resolve' : 'reopen')}>
            {thread.status === 'open' ? '解决' : '重新打开'}</button>
          {activeThread === thread.id && <><input aria-label="回复内容" value={replyText} maxLength={4000} onChange={event => setReplyText(event.target.value)} />
            <button type="button" disabled={busy || !replyText.trim()} onClick={() => void changeThread(thread.id, 'reply')}>提交回复</button></>}
        </div>}
      </li>
    })}
  </ul>

  const coverage = validation?.revision === model.revision ? validation : null
  const tests = coverage?.coverage.find(item => item.id === requirement)?.verifiedBy.filter(item =>
    elements.get(item.id)?.type.split('::').at(-1)?.toLowerCase().replace(/_/g, '') === 'testcase') ?? []

  return <div className="project-layer" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section className="project-dialog" role="dialog" aria-modal="true" aria-label="项目工作区">
      <header><h2>项目工作区 · {name}</h2><button type="button" autoFocus disabled={busy} onClick={onClose}>关闭</button></header>
      <nav aria-label="项目工作区栏目">{SECTIONS.filter(([id]) => id !== 'members' || grant?.canManage).map(([id, label]) =>
        <button type="button" key={id} aria-pressed={section === id} onClick={() => { setSection(id); setError(''); setNotice('') }}>{label}</button>)}</nav>
      <div className="project-contents">
        {error && <p className="project-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!overview && <p className="project-muted">正在读取项目工作区，或当前账号无访问权限。</p>}
        {section === 'review' && <>
          {target ? describe(model, target) : <p className="project-muted">选中元素、关系或图表，可查看详情及复制链接。</p>}
          {target && targetValue(model, target) && grant?.canReview && <form className="project-actions" onSubmit={event => {
            event.preventDefault(); void run(async () => { await api.review(target, threadText, model.revision); setThreadText(''); await onRefresh() })
          }}><label className="project-link">发起对象批注<textarea rows={2} maxLength={4000} value={threadText} onChange={event => setThreadText(event.target.value)} /></label>
            <button className="project-primary" disabled={busy || !threadText.trim()}>添加批注</button></form>}
          <h3>项目评审</h3>
          <label>筛选 <select value={reviewFilter} onChange={event => setReviewFilter(event.target.value)}>
            <option value="open">待处理</option><option value="resolved">已解决</option><option value="all">全部</option>
          </select></label>
          {threads(overview?.reviews.filter(item => reviewFilter === 'all' || item.status === reviewFilter) ?? [])}
        </>}
        {section === 'trace' && <>
          <div className="project-fields"><label>起点<select value={traceId} onChange={event => { setTraceId(event.target.value); setTrace(null) }}>
            <option value="">选择模型对象</option>{model.elements.filter(item => !isExtensionId(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
            <label>方向<select value={direction} onChange={event => setDirection(event.target.value)}><option value="both">双向</option><option value="up">沿关系方向</option><option value="down">逆关系方向</option></select></label>
            <label>深度<input type="number" min={1} max={8} value={traceDepth} onChange={event => setTraceDepth(Number(event.target.value))} /></label>
            <button className="project-primary" type="button" disabled={busy || !traceId} onClick={() => void run(async () => {
              setTrace(await api.trace(traceId, traceDepth, direction, relations))
            })}>查询追溯</button>
          </div>
          <div className="project-actions">{RELATIONS.map(type => <label key={type}><input type="checkbox" checked={relations.includes(type)} onChange={event =>
            setRelations(values => event.target.checked ? [...values, type] : values.filter(item => item !== type))} /> {type}</label>)}</div>
          {trace && <><p role="status">找到 {trace.nodes.length} 个对象{trace.truncated && '，结果已截断'}</p>
            <ul>{trace.nodes.map(node => <li key={node.target.id}><button type="button" onClick={() => locate(node.target)}>{node.target.label}</button>
              <span className="project-path">第 {node.depth} 层 · {node.path.map(edge => `${elements.get(edge.sourceId)?.name ?? edge.sourceId} → ${edge.type}${edge.inferred ? '（属性）' : ''} → ${elements.get(edge.targetId)?.name ?? edge.targetId}`).join(' / ')}</span></li>)}</ul></>}
          <h3>验证证据</h3>
          {coverage && <p>满足关系 {coverage.coverageSummary.satisfied}/{coverage.coverageSummary.total} · 验证关系 {coverage.coverageSummary.verified}/{coverage.coverageSummary.total} · 已记录测试 {coverage.coverageSummary.tested ?? 0}/{coverage.coverageSummary.total}</p>}
          <div className="project-fields"><label>需求<select value={requirement} onChange={event => { setRequirement(event.target.value); setTest('') }}>
            <option value="">选择需求</option>{coverage?.coverage.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {requirement && <span>{RESULTS[coverage?.results?.[requirement] ?? 'missing']}</span>}
            {grant?.canReview && <><label>验证用例<select value={test} onChange={event => setTest(event.target.value)}>
              <option value="">选择已关联的测试用例</option>{tests.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>结果<select value={result} onChange={event => setResult(event.target.value === 'fail' ? 'fail' : 'pass')}><option value="pass">通过</option><option value="fail">未通过</option></select></label>
              <label>依据<input value={source} maxLength={2000} placeholder="试验记录编号或链接" onChange={event => setSource(event.target.value)} /></label>
              <button type="button" disabled={busy || !requirement || !test || !source.trim()} onClick={() => void saveResult()}>登记测试结果</button></>}
          </div>
        </>}
        {section === 'members' && grant?.canManage && <>
          <form className="project-fields" onSubmit={event => { event.preventDefault(); void run(async () => {
            await api.changeMember(member, role); setMember(''); await onRefresh()
          }) }}><label>登录账号<input value={member} onChange={event => setMember(event.target.value)} pattern="[a-zA-Z0-9_.@\-]{1,80}" required /></label>
            <label>项目角色<select value={role} onChange={event => setRole(event.target.value)}>
              {Object.entries(ROLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <button className="project-primary" disabled={busy || !member.trim()}>保存成员权限</button>
          </form>
          <table className="project-grid"><thead><tr><th>账号</th><th>角色</th><th>操作</th></tr></thead><tbody>{overview?.members.map(item =>
            <tr key={item.username}><td>{item.username}</td><td>{ROLES[item.role]}</td><td>{!item.inherited && <button type="button" disabled={busy} onClick={() => void run(async () => {
              await api.changeMember(item.username, null); await onRefresh()
            })}>撤销权限</button>}</td></tr>)}</tbody></table>
        </>}
        {section === 'baseline' && <>
          {grant?.canManage && grant.canEdit && <form className="project-fields" onSubmit={event => { event.preventDefault(); void run(async () => {
            const saved = await api.publish(baselineName, notes, model.revision)
            setBaselineName(''); setNotes(''); await onRefresh(); await openBaseline(saved.id)
          }) }}><label>基线名称<input value={baselineName} maxLength={120} onChange={event => setBaselineName(event.target.value)} /></label>
            <label>发布说明<input value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} /></label>
            <button className="project-primary" disabled={busy || !baselineName.trim() || Boolean(coverage?.counts.error)}>发布 rev {model.revision}</button>
            {Boolean(coverage?.counts.error) && <span className="project-error">有 {coverage?.counts.error} 项结构错误待修复。</span>}
          </form>}
          <div className="project-fields"><label>基线<select aria-label="已发布基线" value={baseline?.info.id ?? ''} onChange={event => {
            const id = event.target.value; void run(() => openBaseline(id))
          }}><option value="">选择已发布基线</option>{overview?.baselines.map(item => <option key={item.id} value={item.id}>{item.name} · rev {item.revision}</option>)}</select></label>
            {baseline && <><label>对比基线<select value={compareTo} onChange={event => {
              const id = event.target.value; setCompareTo(id); setDifferences(null)
              if (id) void run(async () => { setDifferences(await api.diff(baseline.info.id, id)) })
            }}><option value="">发布时的对比基线</option>{overview?.baselines.filter(item => item.id !== baseline.info.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {grant?.canExport && <button type="button" disabled={busy} onClick={() => {
                const snapshot = baseline.snapshot
                const baselineName = snapshot.elements.find(item => !item.ownerId)?.name ?? name
                setReport(buildModelReportHtml({ projectName: baselineName, model: snapshot, validation: baseline.validation,
                  elements: snapshot.elements.filter(item => !isExtensionId(item.id)), generatedAt: new Date(baseline.info.at),
                  labels: { type: code => code, diagram: code => code, relation: code => code },
                  baseline: { record: baseline, url: item => projectLink(project, item, baseline.info.id) } }))
              }}>生成基线报告</button>}
              {grant?.canManage && grant.canEdit && <button type="button" disabled={busy} onClick={() => setRestore(!restore)}>恢复此基线</button>}</>}
          </div>
          {baseline && <>
            <p>{baseline.info.name} · rev {baseline.info.revision} · {baseline.info.author} · {new Date(baseline.info.at).toLocaleString()}</p>
            {baseline.info.notes && <p>{baseline.info.notes}</p>}
            <label className="project-link">基线链接<input readOnly value={projectLink(project, undefined, baseline.info.id)} onFocus={event => event.currentTarget.select()} /></label>
            {restore && <div className="project-actions"><span>确认将当前模型恢复为此基线内容，并生成一个新版本。</span>
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                await api.restore(baseline.info.id, model.revision); setRestore(false); setNotice('已恢复并生成新版本'); await onRefresh(true)
              })}>确认恢复</button><button type="button" onClick={() => setRestore(false)}>取消</button></div>}
            {baselineTarget && describe(baseline.snapshot, baselineTarget, baseline.info.id)}
            <h3>变更明细（{(differences ?? baseline.changes).length}）</h3>
            <div className="project-grid-scroll"><table className="project-grid"><thead><tr><th>对象</th><th>操作</th><th>字段</th><th>原值</th><th>新值</th></tr></thead><tbody>
              {(differences ?? baseline.changes).map((change, index) => <tr key={index}><td><button type="button" onClick={() => {
                const previous = compareTo || baseline.info.comparedTo
                if (change.action === 'remove' && previous) locate(change, previous)
                else setBaselineTarget(change)
              }}>{change.label}</button></td><td>{{ add: '新增', remove: '删除', update: '修改' }[change.action]}</td><td>{change.field}</td>
                <td>{JSON.stringify(change.before)}</td><td>{JSON.stringify(change.after)}</td></tr>)}
            </tbody></table></div>
            <details><summary>基线评审（{baseline.reviews.length}）</summary>{threads(baseline.reviews, true)}</details>
          </>}
          {Boolean(overview?.restorations.length) && <details><summary>恢复历史</summary><ul>{overview?.restorations.map(item => <li key={item.id}>
            {item.author} · {new Date(item.at).toLocaleString()} · rev {item.fromRevision} → rev {item.revision}</li>)}</ul></details>}
          {report && <div className="project-report">
            <div className="project-actions"><button type="button" onClick={() => {
              const url = URL.createObjectURL(new Blob([report], { type: 'text/html;charset=utf-8' }))
              const link = document.createElement('a'); link.href = url; link.download = `${baseline?.info.name ?? name}-评审报告.html`; link.click()
              window.setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}>下载 HTML</button><button type="button" onClick={() => reportFrame.current?.contentWindow?.print()}>打印 / PDF</button></div>
            <iframe ref={reportFrame} title="基线评审报告" srcDoc={report} />
          </div>}
        </>}
      </div>
    </section>
  </div>
}
