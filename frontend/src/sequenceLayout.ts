// 序列图的图面计算：生命线列、消息时间槽、激活条、组合片段、销毁终止符与图框。
//
// 数据契约（与元模型一致，不新造字段）：
//   · 生命线 = Lifeline 元素。记法 x 决定它在哪一列（列序 = x 序），y 只用来取整表头行高
//     （全部对齐到最靠上的一条）。被 createMessage 打中的生命线例外：表头落在该消息行。
//     外部导入常把生命线摆成 2×2 网格（x 只有两三种），这时按 (y, x) 读列序并等距重排，
//     否则两条表头会叠在同一列上 —— SaaS 商业化方案项目导入的 5 张时序图就是这种坐标。
//   · 消息 = 两条生命线之间的 message 关系。时间槽位置由 `messageOrder`（1..n 排位）决定；
//     兼容外部导入：序号也可能写在关系的 name（纯数字）或 documentation（「消息 N：…」）里。
//     消息文本优先取 documentation，其次 name（纯数字不算文本）。
//   · 外部导入还常带 Message 元素（每条消息一个）却只建了一部分 message 关系。缺失的那些
//     按元素 documentation 里的「A → B「文本」」补成**只读虚拟消息**，图面完整但不落库、不改序。
//   · 消息种类 = messageSort 元属性（UML 规范枚举）；外部导入没有该属性时按标签 + 方向
//     推断 reply（只在「看起来像导入数据」时启用，避免影响界面新建的消息）。
//   · 组合片段 = CombinedFragment 元素。`interactionOperator`（alt/opt/loop/…）+ `coveredFrom`
//     / `coveredTo`（消息排位区间）+ `guards`（分支守卫）都是规范/扩展元属性，落库；
//     图面按区间现算框的位置，不再画成普通方块。
//   · 激活条 = 由消息推导的纯图面元素（不落库），按调用栈推进：
//     收到一次同步/异步调用 = 在接收端压一层激活；从该生命线发出 reply = 弹一层。
//   · 销毁 = deleteMessage 打到的那条生命线在该行终止，虚线到此为止并画 X。
//
// 没有生命线时返回 null，调用方回落到通用「方块 + 连线」渲染。

import type { ModelElement, Relationship } from './types'
import { normalizeRelKey, normalizeTypeKey } from './notation'

/** 表头框高度：所有生命线一致，比通用节点矮。 */
export const SEQ_HEADER_HEIGHT = 44
/** 表头最小宽度：窄记法也要放得下名字。 */
export const SEQ_HEADER_MIN_WIDTH = 110
/** 表头底边到第一条消息的时间间隔。 */
export const SEQ_FIRST_GAP = 52
/** 相邻两条消息的时间槽间距。 */
export const SEQ_ROW_PITCH = 54
/** 最后一条消息到生命线末端的余量。 */
export const SEQ_END_GAP = 44
/** 没有任何消息时，生命线至少伸出这么长。 */
export const SEQ_MIN_AXIS = 180
/** 激活条基础宽度（居中压在生命线上）。 */
export const SEQ_ACTIVATION_WIDTH = 12
/** 自消息向右折出的长度。 */
export const SEQ_SELF_BUMP = 36
/** 自消息回环的高度（折下去再折回来）。 */
export const SEQ_SELF_HEIGHT = 16
/** 被 createMessage 创建的生命线：表头落在消息行下方这么多像素，箭头斜指表头顶边。 */
export const SEQ_CREATE_OFFSET = 8
/**
 * 时间槽序号就是 1..n 的排位（属性面板里显示的「消息顺序」）。
 * 改顺序一律整条时间轴重排（SET_MESSAGE_ORDER），所以不需要留插空档。
 */
export const SEQ_MESSAGE_STEP = 1
/** 图框内边距。 */
export const SEQ_FRAME_PAD = 24
/** 图框左上角标签高度（五边形 + 名字）。 */
export const SEQ_FRAME_LABEL = 24
/** 网格坐标重排时相邻两列的间距下限。 */
export const SEQ_COLUMN_GAP = 44
/** 组合片段框的水平内边距。 */
export const SEQ_FRAGMENT_PAD = 16
/** 组合片段框在时间槽上下各留的余量。 */
export const SEQ_FRAGMENT_TOP_PAD = 22
export const SEQ_FRAGMENT_BOTTOM_PAD = 18

export interface SeqLifeline {
  element: ModelElement
  /** 表头左上角。 */
  x: number
  y: number
  width: number
  height: number
  /** 生命线所在列（表头水平中心）。 */
  axisX: number
  /** 虚线底边。 */
  bottom: number
  /** 被销毁的行：虚线到此为止。 */
  destroyedAt?: number
  /** 本生命线是被创建出来的（表头不在公共表头行）。 */
  created: boolean
}

export type SeqMessageSort =
  | 'synchCall'
  | 'asynchCall'
  | 'asynchSignal'
  | 'createMessage'
  | 'deleteMessage'
  | 'reply'

export interface SeqActivation {
  lifelineId: string
  x: number
  y: number
  width: number
  height: number
  /** 嵌套深度：0 是最外层，内层向右偏一点、窄一点，像标准 UML 的套层。 */
  depth: number
}

export interface SeqMessage {
  relation: Relationship
  /** 时间轴序号（1 起）：用来显示「1: 提交订单」。 */
  seqNo: number
  /** 排序键：messageOrder / 导入序号，缺省为按创建顺序补的序号。 */
  order: number
  /** 时间槽 y：消息线就画在这一行上。 */
  y: number
  fromX: number
  toX: number
  /**
   * 箭头终点的 y：只有 createMessage 与 y 不同 —— 它斜指被创建生命线的表头顶边，
   * 而不是平平地扎进那条生命线的轴心。其余消息一律缺省（等于 y）。
   */
  endY?: number
  sort: SeqMessageSort
  label: string
  /** 自消息（源与目标同一条生命线）。 */
  self: boolean
  /** 该消息到达时压在接收端的那条激活条（决定箭头停在哪个边缘）。 */
  activation?: { x: number; width: number; y: number; height: number }
  /** 由 Message 元素补出来的只读消息：没有真实关系，不能改序 / 不能进属性面板。 */
  virtual?: boolean
}

export interface SeqFrame {
  element: ModelElement
  x: number
  y: number
  width: number
  height: number
  label: string
}

/** 组合片段：alt / opt / loop … 的框与操作数。 */
export interface SeqFragment {
  element: ModelElement
  operator: string
  guards: string[]
  x: number
  y: number
  width: number
  height: number
  /** 覆盖的消息排位（含端点），仅用于属性核对。 */
  fromSeq: number
  toSeq: number
  /** 每个操作数区域的上边界（画分隔虚线用）。 */
  operandLines: number[]
}

export interface SeqPlacement {
  lifelines: SeqLifeline[]
  messages: SeqMessage[]
  activations: SeqActivation[]
  /** 序列图的交互框：Interaction 元素进图时画成 UML 图框，而不是一个普通方块。 */
  frame: SeqFrame | null
  /** 组合片段（按起始排位排序）。 */
  fragments: SeqFragment[]
  /** 画不出来的消息（端点不是生命线）：调用方按通用连线渲染，不要让它们凭空消失。 */
  fallbackRelations: Relationship[]
  bottom: number
  box: { left: number; top: number; right: number; bottom: number }
}

export interface SeqItem {
  element: ModelElement
  x: number
  y: number
  w: number
  h: number
}

/** 布局上下文：补 Message 元素、找组合片段所需的额外模型数据。 */
export interface SeqLayoutContext {
  elements?: ModelElement[]
  /** 当前序列图的宿主 Interaction（图的 ownerId）。 */
  interactionId?: string | null
}

const MESSAGE_SORTS: SeqMessageSort[] =
  ['synchCall', 'asynchCall', 'asynchSignal', 'createMessage', 'deleteMessage', 'reply']

const FRAGMENT_OPERATORS =
  ['alt', 'opt', 'par', 'loop', 'critical', 'neg', 'assert', 'strict', 'seq', 'ignore', 'consider', 'break', 'ref']

function isLifeline(type: string): boolean {
  return normalizeTypeKey(type) === 'lifeline'
}

function isInteraction(type: string): boolean {
  return normalizeTypeKey(type) === 'interaction'
}

function isFragment(type: string): boolean {
  return normalizeTypeKey(type) === 'combinedfragment'
}

function isMessageElement(type: string): boolean {
  const key = normalizeTypeKey(type)
  return key === 'message' || key === 'messageoccurrence'
}

function isMessageRelation(relation: Relationship): boolean {
  return normalizeRelKey(relation.type) === 'message'
}

/** messageSort：先看规范元属性，再看标记值，最后按 UML 缺省的同步调用。 */
export function messageSortOf(relation: Relationship): SeqMessageSort {
  const raw = relation.properties?.messageSort ?? relation.taggedValues?.messageSort
  const text = typeof raw === 'string' ? raw.trim() : ''
  return (MESSAGE_SORTS as string[]).includes(text) ? (text as SeqMessageSort) : 'synchCall'
}

/** 显式 messageSort（没写就返回 null，和「缺省 synchCall」区分开）。 */
function explicitMessageSort(relation: Relationship): SeqMessageSort | null {
  const raw = relation.properties?.messageSort ?? relation.taggedValues?.messageSort
  const text = typeof raw === 'string' ? raw.trim() : ''
  return (MESSAGE_SORTS as string[]).includes(text) ? (text as SeqMessageSort) : null
}

/**
 * 消息文本：外部导入把正文放在 documentation（也可能是「消息 N：A → B「正文」」），
 * 界面新建的消息把正文放在 name。name 是纯数字（导入的序号）时不当正文。
 */
export function messageLabelOf(relation: Relationship): string {
  const doc = (relation.documentation ?? '').trim()
  if (doc) {
    const quoted = /[「『](.+?)[」』]/.exec(doc)
    if (quoted) {
      return quoted[1].trim()
    }
    return doc.replace(/^消息\s*\d+\s*[:：]\s*/, '').trim()
  }
  const name = (relation.name ?? '').trim()
  return /^\d+$/.test(name) ? '' : name
}

/** 导入序号：name 是数字，或 documentation 以「消息 N」开头。 */
export function importedOrderOf(relation: Relationship): number | null {
  const name = (relation.name ?? '').trim()
  if (/^\d+$/.test(name)) {
    return Number.parseInt(name, 10)
  }
  const doc = /^消息\s*(\d+)\s*[:：]/.exec((relation.documentation ?? '').trim())
  return doc ? Number.parseInt(doc[1], 10) : null
}

/** messageOrder：显式排序键；没有就看导入序号；再没有就是 null（按创建顺序垫后）。 */
export function messageOrderOf(relation: Relationship): number | null {
  const raw = relation.properties?.messageOrder
  const numeric = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
  if (Number.isFinite(numeric)) {
    return numeric
  }
  return importedOrderOf(relation)
}

/** 只有「看起来像导入数据」的消息才做 reply 推断：界面新建的消息一律按同步调用。 */
function looksImported(relation: Relationship): boolean {
  return /^\d+$/.test((relation.name ?? '').trim()) || !!(relation.documentation ?? '').trim()
}

const REPLY_WORDS = /(返回|回执|回复|响应|应答|答复|驳回|拒绝|结果|清单|通过|已失效|不受影响|允许|放行|状态|收口)/

/** 外部导入没有 messageSort 时，按标签词 + 方向推断 reply（向左的回信）。 */
function inferMessageSort(
  relation: Relationship,
  label: string,
  fromX: number,
  toX: number,
): SeqMessageSort {
  const explicit = explicitMessageSort(relation)
  if (explicit) {
    return explicit
  }
  if (!looksImported(relation)) {
    return 'synchCall'
  }
  if (/^(返回|回执|回复|响应|应答|答复)/.test(label)) {
    return 'reply'
  }
  if (toX < fromX && REPLY_WORDS.test(label)) {
    return 'reply'
  }
  return 'synchCall'
}

/**
 * 新消息落在时间轴末尾：取本条时间轴（当前图上的消息）最大序号 + 步长。
 * 只按本图算——别的序列图有自己的时间轴，不该把序号顶到天上去。
 */
export function nextMessageOrder(messages: { order: number }[]): number {
  let max = 0
  for (const message of messages) {
    if (message.order > max) {
      max = message.order
    }
  }
  return max > 0 ? Math.floor(max) + SEQ_MESSAGE_STEP : SEQ_MESSAGE_STEP
}

/**
 * 一次改序只写真实关系；虚拟消息不落库，不能进 items。
 * 序号取「整体时间轴的新排位」，不按真实关系重新压缩 —— 否则含补全消息的图
 * 改序后会把补全消息全挤到末尾。
 */
function writeItems(messages: SeqMessage[]): { id: string; order: number }[] {
  return messages
    .map((message, index) => ({ message, order: (index + 1) * SEQ_MESSAGE_STEP }))
    .filter((entry) => !entry.message.virtual)
    .map((entry) => ({ id: entry.message.relation.id, order: entry.order }))
}

/** 当前时间轴的稳定顺序（显式序号优先，其次导入序号，最后数组顺序；虚拟消息并列垫后）。 */
function orderedMessages(messages: SeqMessage[]): SeqMessage[] {
  return [...messages].sort((a, b) =>
    a.order - b.order || Number(!!a.virtual) - Number(!!b.virtual) || a.seqNo - b.seqNo)
}

/**
 * 上移 / 下移一条消息：只在本条时间轴内换位，返回整条时间轴归一化后的顺序（1, 2, 3, …）。
 * 调用方一条 SET_MESSAGE_ORDER 提交，服务端一个 revision、一步撤销。
 */
export function reorderMessages(
  messages: SeqMessage[],
  relationId: string,
  delta: number,
): { id: string; order: number }[] {
  const ordered = orderedMessages(messages)
  const from = ordered.findIndex((message) => message.relation.id === relationId)
  if (from < 0 || ordered[from].virtual) {
    return []
  }
  const to = Math.min(ordered.length - 1, Math.max(0, from + delta))
  if (to === from) {
    return []
  }
  const moved = ordered.splice(from, 1)[0]
  ordered.splice(to, 0, moved)
  return writeItems(ordered)
}

/** 拖动到指定下标：与 Alt+↑/↓ 共用一条命令通道。 */
export function reorderMessagesTo(
  messages: SeqMessage[],
  relationId: string,
  targetIndex: number,
): { id: string; order: number }[] {
  const ordered = orderedMessages(messages)
  const from = ordered.findIndex((message) => message.relation.id === relationId)
  if (from < 0 || ordered[from].virtual) {
    return []
  }
  const to = Math.min(ordered.length - 1, Math.max(0, targetIndex))
  if (to === from) {
    return []
  }
  const moved = ordered.splice(from, 1)[0]
  ordered.splice(to, 0, moved)
  return writeItems(ordered)
}

interface ParsedMessageElement {
  seq: number
  label: string
  sourceName: string
  targetName: string
  element: ModelElement
}

/**
 * 解析导入的 Message 元素：documentation 形如
 * 「消息 1：客户 → 交易服务「确认订单并发起支付」」，name 形如「1 确认订单并发起支付」。
 */
function parseMessageElement(element: ModelElement): ParsedMessageElement | null {
  const head = /^\s*(\d+)/.exec(element.name ?? '')
  if (!head) {
    return null
  }
  const seq = Number.parseInt(head[1], 10)
  const doc = (element.documentation ?? '').trim()
  const arrow = doc.includes('→') ? '→' : doc.includes('->') ? '->' : null
  if (!arrow) {
    return null
  }
  const [left, right = ''] = doc.split(arrow)
  const sourceName = left.replace(/^消息\s*\d+\s*[:：]\s*/, '').trim()
  const targetName = right.replace(/[「『].*$/, '').trim()
  const quoted = /[「『](.+?)[」』]/.exec(right)
  const signal = element.properties?.signal
  const label = quoted?.[1]?.trim()
    || (typeof signal === 'string' ? signal.trim() : '')
    || (element.name ?? '').replace(/^\s*\d+\s*/, '').trim()
  if (!sourceName || !targetName) {
    return null
  }
  return { seq, label, sourceName, targetName, element }
}

function matchLifeline(name: string, lifelines: { element: ModelElement }[]): string | null {
  const exact = lifelines.find((line) => line.element.name.trim() === name)
  if (exact) {
    return exact.element.id
  }
  const partial = lifelines.find((line) =>
    name.includes(line.element.name.trim()) || line.element.name.trim().includes(name))
  return partial?.element.id ?? null
}

/** 组合片段的扩展元属性（都是从属性面板写进 properties 的）。 */
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\s*[,;|]\s*/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function integer(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : fallback
}

export function layoutSequence(
  items: SeqItem[],
  relationships: Relationship[],
  context: SeqLayoutContext = {},
): SeqPlacement | null {
  const lifelineItems = items.filter((item) => isLifeline(item.element.type))
  if (lifelineItems.length === 0) {
    return null
  }

  const headerY = Math.min(...lifelineItems.map((item) => item.y))
  // 外部导入把生命线排成 2×2 网格时 x 会重复；这时改按 (y, x) 读列序并等距重排，
  // 否则同一列会叠两个表头。示例/手拖过的图 x 各不相同，保持原坐标不动。
  const distinctX = new Set(lifelineItems.map((item) => Math.round(item.x))).size
  const grid = distinctX < lifelineItems.length
  const orderedItems = grid
    ? [...lifelineItems].sort((a, b) => a.y - b.y || a.x - b.x || a.element.id.localeCompare(b.element.id))
    : [...lifelineItems].sort((a, b) => a.x - b.x || a.y - b.y)
  const headerWidth = Math.max(SEQ_HEADER_MIN_WIDTH, ...orderedItems.map((item) => item.w))
  const columnPitch = headerWidth + SEQ_COLUMN_GAP
  const firstX = Math.min(...lifelineItems.map((item) => item.x))

  const baseHeaders = orderedItems.map((item, index) => {
    const width = Math.max(item.w, SEQ_HEADER_MIN_WIDTH)
    const x = grid ? firstX + index * columnPitch : item.x
    return {
      element: item.element,
      x,
      y: headerY,
      width,
      height: SEQ_HEADER_HEIGHT,
      axisX: x + width / 2,
    }
  })
  const axisOf = new Map(baseHeaders.map((header) => [header.element.id, header.axisX]))

  const interactionId = context.interactionId
    ?? items.find((item) => isInteraction(item.element.type))?.element.id
    ?? null

  // ── 消息清单：真实关系 + 由 Message 元素补出的只读虚拟消息 ──────────────
  // 关系不必带 diagramId（外部导入常常没有）：两端生命线都在当前图就属于这条时间轴。
  // 不同序列图的生命线是不同元素，端点判定本身就是图的归属判定。
  const realRelations = relationships
    .map((relation, index) => ({ relation, index }))
    .filter((entry) => isMessageRelation(entry.relation))
    .filter((entry) => axisOf.has(entry.relation.sourceId) && axisOf.has(entry.relation.targetId))

  const coveredOrders = new Set(realRelations.map((entry) =>
    messageOrderOf(entry.relation) ?? importedOrderOf(entry.relation)).filter((value): value is number => value !== null))

  const virtualRelations: { relation: Relationship; index: number }[] = []
  const messageElements = (context.elements ?? []).filter((element) =>
    isMessageElement(element.type) && (!interactionId || element.ownerId === interactionId))
  for (const element of messageElements) {
    const parsed = parseMessageElement(element)
    if (!parsed || coveredOrders.has(parsed.seq)) {
      continue
    }
    const sourceId = matchLifeline(parsed.sourceName, baseHeaders)
    const targetId = matchLifeline(parsed.targetName, baseHeaders)
    if (!sourceId || !targetId) {
      continue
    }
    coveredOrders.add(parsed.seq)
    virtualRelations.push({
      index: 10000 + virtualRelations.length,
      relation: {
        id: `virtual:${element.id}`,
        type: 'message',
        sourceId,
        targetId,
        name: String(parsed.seq),
        documentation: parsed.label,
        stereotypes: [],
        ownerId: element.ownerId,
        taggedValues: {},
        properties: {},
      },
    })
  }

  const candidates = [...realRelations, ...virtualRelations]
    .map((entry) => ({ ...entry, order: messageOrderOf(entry.relation) }))
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY
      const bo = b.order ?? Number.POSITIVE_INFINITY
      return ao === bo ? a.index - b.index : ao - bo
    })

  const firstRow = headerY + SEQ_HEADER_HEIGHT + SEQ_FIRST_GAP
  const messages: SeqMessage[] = candidates.map((entry, index) => {
    const fromX = axisOf.get(entry.relation.sourceId)!
    const toX = axisOf.get(entry.relation.targetId)!
    const label = messageLabelOf(entry.relation)
    return {
      relation: entry.relation,
      seqNo: index + 1,
      order: entry.order ?? (index + 1) * SEQ_MESSAGE_STEP,
      y: firstRow + index * SEQ_ROW_PITCH,
      fromX,
      toX,
      sort: inferMessageSort(entry.relation, label, fromX, toX),
      label,
      self: entry.relation.sourceId === entry.relation.targetId,
      virtual: entry.relation.id.startsWith('virtual:'),
    }
  })

  // 创建 / 销毁：表头位置与虚线末端由这两类消息决定。
  const createdBy = new Map<string, number>()
  const destroyedAt = new Map<string, number>()
  for (const message of messages) {
    if (message.self) {
      continue
    }
    if (message.sort === 'createMessage') {
      createdBy.set(message.relation.targetId, message.y)
    } else if (message.sort === 'deleteMessage') {
      destroyedAt.set(message.relation.targetId, message.y)
    }
  }

  /** message 端点不是生命线的那些：调用方按通用连线画。 */
  const fallbackRelations = relationships.filter((relation) =>
    isMessageRelation(relation)
      && !(axisOf.has(relation.sourceId) && axisOf.has(relation.targetId)))

  const lastRow = messages.length > 0 ? messages[messages.length - 1].y : headerY + SEQ_HEADER_HEIGHT
  const axisBottom = Math.max(lastRow + SEQ_END_GAP, headerY + SEQ_HEADER_HEIGHT + SEQ_MIN_AXIS)

  const lifelines: SeqLifeline[] = baseHeaders.map((header) => {
    const createdY = createdBy.get(header.element.id)
    const destroyY = destroyedAt.get(header.element.id)
    // 被创建出来的生命线：表头落在创建消息下方一点（箭头指向表头），虚线从表头底边起。
    const y = createdY === undefined ? header.y : createdY + SEQ_CREATE_OFFSET
    return {
      ...header,
      y,
      created: createdY !== undefined,
      bottom: destroyY === undefined ? axisBottom : Math.min(axisBottom, destroyY),
      destroyedAt: destroyY,
    }
  })

  const lifelineById = new Map(lifelines.map((lifeline) => [lifeline.element.id, lifeline]))

  // createMessage 的箭头斜指新生命线的表头顶边；时间槽 y 不动，改序仍按行算。
  for (const message of messages) {
    if (message.sort !== 'createMessage' || message.self) {
      continue
    }
    const target = lifelineById.get(message.relation.targetId)
    if (target?.created) {
      message.endY = target.y
    }
  }

  // ── 激活条：按调用栈推进 ──────────────────────────────────────────────
  const activations: SeqActivation[] = []
  const stacks = new Map<string, SeqActivation[]>()
  const stackOf = (id: string) => {
    const existing = stacks.get(id)
    if (existing) {
      return existing
    }
    const created: SeqActivation[] = []
    stacks.set(id, created)
    return created
  }
  const openActivation = (lifelineId: string, y: number): SeqActivation | null => {
    const lifeline = lifelineById.get(lifelineId)
    if (!lifeline) {
      return null
    }
    const stack = stackOf(lifelineId)
    const depth = stack.length
    const width = Math.max(4, SEQ_ACTIVATION_WIDTH - depth * 4)
    const activation: SeqActivation = {
      lifelineId,
      x: lifeline.axisX - SEQ_ACTIVATION_WIDTH / 2 + depth * 4,
      y,
      width,
      height: 0,
      depth,
    }
    stack.push(activation)
    activations.push(activation)
    return activation
  }
  const closeActivation = (lifelineId: string, y: number) => {
    const stack = stacks.get(lifelineId)
    if (!stack || stack.length === 0) {
      return
    }
    const activation = stack.pop()!
    activation.height = Math.max(6, y - activation.y)
  }
  const closeAll = (lifelineId: string, y: number) => {
    while ((stacks.get(lifelineId)?.length ?? 0) > 0) {
      closeActivation(lifelineId, y)
    }
  }

  for (const message of messages) {
    if (message.self) {
      // 自消息：在自己的栈里压一层短线，行内收口，栈深不变。
      const nested = openActivation(message.relation.sourceId, message.y)
      if (nested) {
        nested.height = 16
        const stack = stacks.get(message.relation.sourceId)
        stack?.pop()
      }
      continue
    }
    if (message.sort === 'reply') {
      closeActivation(message.relation.sourceId, message.y)
      continue
    }
    if (message.sort === 'deleteMessage') {
      closeAll(message.relation.targetId, message.y)
      continue
    }
    // createMessage 的箭头指向新生命线的表头：这条消息本身不压激活条，
    // 新生命线的执行由后续对它的调用产生，否则激活条会从表头上方凭空长出来。
    if (message.sort === 'createMessage') {
      continue
    }
    openActivation(message.relation.targetId, message.y)
  }
  for (const lifeline of lifelines) {
    const stack = stacks.get(lifeline.element.id)
    while (stack && stack.length > 0) {
      closeActivation(lifeline.element.id, lifeline.bottom)
    }
  }

  /** 某个 y 上、某条生命线最深的那条激活条：箭头要停在这条的边缘。 */
  const barAt = (lifelineId: string, y: number): SeqActivation | null => {
    let best: SeqActivation | null = null
    for (const activation of activations) {
      if (activation.lifelineId !== lifelineId) {
        continue
      }
      const end = activation.y + activation.height
      if (y < activation.y || y > end) {
        continue
      }
      if (!best || activation.depth >= best.depth) {
        best = activation
      }
    }
    return best
  }
  for (const message of messages) {
    if (message.self) {
      continue
    }
    const bar = barAt(message.relation.targetId, message.y)
    if (bar) {
      message.activation = { x: bar.x, width: bar.width, y: bar.y, height: bar.height }
    }
  }

  // ── 组合片段：区间是模型数据（消息排位），图面现算 ─────────────────────
  const fragmentElements = [
    ...items.filter((item) => isFragment(item.element.type)).map((item) => item.element),
    ...(context.elements ?? []).filter((element) =>
      isFragment(element.type) && interactionId && element.ownerId === interactionId),
  ].filter((element, index, all) => all.findIndex((other) => other.id === element.id) === index)

  const minLifelineX = Math.min(...lifelines.map((line) => line.x))
  const maxLifelineRight = Math.max(...lifelines.map((line) => line.x + line.width))
  const totalMessages = messages.length
  const fragments: SeqFragment[] = fragmentElements.map((element) => {
    const rawOperator = String(element.properties?.interactionOperator ?? '').trim().toLowerCase()
    const operator = FRAGMENT_OPERATORS.includes(rawOperator) ? rawOperator : 'opt'
    let guards = stringList(element.properties?.guards)
    if (operator === 'alt' && guards.length === 0) {
      guards = ['', 'else']
    }
    const fromSeq = Math.min(totalMessages || 1, integer(element.properties?.coveredFrom, 1))
    const toSeq = Math.min(totalMessages || 1, Math.max(fromSeq, integer(element.properties?.coveredTo, totalMessages || 1)))
    const top = firstRow + (fromSeq - 1) * SEQ_ROW_PITCH - SEQ_FRAGMENT_TOP_PAD
    const bottom = firstRow + (toSeq - 1) * SEQ_ROW_PITCH + SEQ_FRAGMENT_BOTTOM_PAD
    const height = Math.max(48, bottom - top)
    const operandLines = guards.length > 1
      ? guards.slice(1).map((_, index) => top + (height * (index + 1)) / guards.length)
      : []
    return {
      element,
      operator,
      guards,
      x: minLifelineX - SEQ_FRAGMENT_PAD,
      y: top,
      width: maxLifelineRight - minLifelineX + SEQ_FRAGMENT_PAD * 2,
      height,
      fromSeq,
      toSeq,
      operandLines,
    }
  }).sort((a, b) => a.fromSeq - b.fromSeq || a.y - b.y)

  // ── 图框：Interaction 进图时按 UML 的 sd 框画，不再当普通方块 ──────────
  // 外部导入常把 Interaction 只作为图的 ownerId（不放进 elementIds），这时按 ownerId
  // 回查模型元素补一个虚拟 item —— 图依然应该有 sd 框，而不是光秃秃几条生命线。
  const frameItem = items.find((item) => isInteraction(item.element.type))
    ?? (() => {
      const owner = (context.elements ?? []).find((element) =>
        element.id === interactionId && isInteraction(element.type))
      return owner
        ? { element: owner, x: minLifelineX, y: headerY, w: 0, h: 0 }
        : undefined
    })()
  const others = items.filter((item) =>
    !isLifeline(item.element.type) && !isFragment(item.element.type) && item !== frameItem)
  const contentRight = Math.max(
    ...lifelines.map((line) => line.x + line.width),
    ...others.map((item) => item.x + item.w),
    ...messages.map((message) => Math.max(message.fromX, message.toX) + SEQ_SELF_BUMP),
    ...fragments.map((fragment) => fragment.x + fragment.width),
  )
  const contentLeft = Math.min(
    ...lifelines.map((line) => line.x),
    ...others.map((item) => item.x),
    ...messages.map((message) => Math.min(message.fromX, message.toX)),
    ...fragments.map((fragment) => fragment.x),
  )
  const contentTop = Math.min(headerY, ...others.map((item) => item.y), ...lifelines.map((line) => line.y),
    ...fragments.map((fragment) => fragment.y))
  const frame: SeqFrame | null = frameItem
    ? {
        element: frameItem.element,
        x: contentLeft - SEQ_FRAME_PAD,
        y: contentTop - SEQ_FRAME_PAD - SEQ_FRAME_LABEL,
        width: contentRight - contentLeft + SEQ_FRAME_PAD * 2,
        height: axisBottom - (contentTop - SEQ_FRAME_PAD - SEQ_FRAME_LABEL) + SEQ_FRAME_PAD,
        label: frameItem.element.name,
      }
    : null

  const box = {
    left: Math.min(contentLeft, ...others.map((item) => item.x), frame?.x ?? Number.POSITIVE_INFINITY),
    top: Math.min(contentTop, ...others.map((item) => item.y), frame?.y ?? Number.POSITIVE_INFINITY),
    right: Math.max(contentRight, ...others.map((item) => item.x + item.w), frame ? frame.x + frame.width : 0),
    bottom: Math.max(axisBottom, ...others.map((item) => item.y + item.h),
      ...fragments.map((fragment) => fragment.y + fragment.height), frame ? frame.y + frame.height : 0),
  }

  return { lifelines, messages, activations, frame, fragments, fallbackRelations, bottom: axisBottom, box }
}

/**
 * 序列图工具箱里「消息种类」的组件定义。
 *
 * 一条消息在元模型里始终是同一个 `message` 关系，种类只是 `messageSort` 元属性；
 * 但桌面建模器给的是一组工具按钮而不是一个「消息 + 属性面板改枚举」，所以这里把
 * 六种规范枚举 + 「给自己的消息」（source = target 的自反同步调用）显式列成工具。
 * hint / label 都是中文原文词条，交给 t() / pick() 翻译。
 */
export type SeqMessageToolKey = SeqMessageSort | 'self'

export interface SeqMessageToolDef {
  key: SeqMessageToolKey
  label: string
  labelEn: string
  /** 新建关系时写进 properties.messageSort 的规范枚举值。 */
  sort: SeqMessageSort
  /** 自消息只点一条生命线：source = target。 */
  self: boolean
  /** 选中工具后的操作提示（中文原文词条）。 */
  hint: string
}

const TWO_END_HINT = '在画布上依次点击起点、终点生命线（Esc 退出）'
const SELF_HINT = '点击一条生命线，即可建出给自己的消息'

export const SEQ_MESSAGE_TOOLS: SeqMessageToolDef[] = [
  { key: 'synchCall', label: '同步消息', labelEn: 'Synchronous call',
    sort: 'synchCall', self: false, hint: TWO_END_HINT },
  { key: 'asynchCall', label: '异步消息', labelEn: 'Asynchronous call',
    sort: 'asynchCall', self: false, hint: TWO_END_HINT },
  { key: 'asynchSignal', label: '异步信号', labelEn: 'Asynchronous signal',
    sort: 'asynchSignal', self: false, hint: TWO_END_HINT },
  { key: 'reply', label: '返回消息', labelEn: 'Reply message',
    sort: 'reply', self: false, hint: TWO_END_HINT },
  { key: 'createMessage', label: '创建消息', labelEn: 'Create message',
    sort: 'createMessage', self: false, hint: TWO_END_HINT },
  { key: 'deleteMessage', label: '销毁消息', labelEn: 'Delete message',
    sort: 'deleteMessage', self: false, hint: TWO_END_HINT },
  { key: 'self', label: '给自己的消息', labelEn: 'Self message',
    sort: 'synchCall', self: true, hint: SELF_HINT },
]

export function seqMessageToolOf(key: string | null | undefined): SeqMessageToolDef | null {
  return SEQ_MESSAGE_TOOLS.find((tool) => tool.key === key) ?? null
}

/** 消息线型（UML 规范）：同步实心箭头、异步与信号开放箭头、创建/删除/回复各有自己的虚线节奏。 */
export function messageSortStyle(sort: SeqMessageSort): {
  color: string
  dashed: boolean
  /** strokeDasharray 的节奏：信号用短点线、销毁用粗断线、回复用长虚线，一眼可辨。 */
  dash: string
  arrow: 'filled' | 'open'
  stereotype: string
} {
  switch (sort) {
    case 'asynchCall':
      return { color: '#3182ce', dashed: false, dash: '', arrow: 'open', stereotype: '' }
    case 'asynchSignal':
      return { color: '#3182ce', dashed: true, dash: '3 3', arrow: 'open', stereotype: '' }
    case 'createMessage':
      return { color: '#2f855a', dashed: false, dash: '', arrow: 'open', stereotype: 'create' }
    case 'deleteMessage':
      return { color: '#c53030', dashed: true, dash: '6 3', arrow: 'open', stereotype: 'delete' }
    case 'reply':
      return { color: '#805ad5', dashed: true, dash: '7 4', arrow: 'open', stereotype: 'reply' }
    case 'synchCall':
    default:
      return { color: '#3182ce', dashed: false, dash: '', arrow: 'filled', stereotype: '' }
  }
}
