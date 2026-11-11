// 自动排布：把「关系散乱」的图重排成层次清楚、疏密均匀的图面。
//
// layered —— 沿关系方向分层（satisfy / include / controlFlow 这些有向关系决定先后次序），
//            层内用中位数重心法排序以减少交叉；一层铺太长就拆段，一路铺太长就折行，
//            折行走蛇形（第二行反着走），让首尾相接的那条线落在同一侧、不必横跨整个图面。
// hubbed  —— 高度数的中心节点（参与者、系统块）摘出来贴在最外侧一列，其余按「连到哪个中心」
//            成簇分块铺开，中心纵向对齐到自己那簇的中位位置。用例图这类星形结构只有这么排
//            才不是一张网：同一个中心的线聚成扇形，彼此不再穿插。
// grouped —— 按父子归属分块（包、系统块、状态机），父在上、子在下成排铺开，适合关系稀疏的结构图。
//
// strategy 为 'auto' 时三种策略、两个方向、几档折行宽度各算一遍，再按包围盒量化取舍：
// 接近视口比例、占文档面积小、折行少者胜。这里只做计算；落库由调用方发一条 SET_NOTATIONS 一次写完。

import type { ModelElement, Relationship } from './types'

export type LayoutStrategy = 'layered' | 'grouped' | 'hubbed'
export type LayoutChoice = LayoutStrategy | 'auto'
export type LayoutAxis = 'right' | 'down'

export interface Placement {
  elementId: string
  x: number
  y: number
}

export interface LayoutInput {
  /** 图上的元素；顺序无关，内部按名称取稳定次序。 */
  elements: ModelElement[]
  /** 全部关系，只取两端都在这张图上的那些。 */
  relationships: Relationship[]
  /** 文档范围（服务端 CANVAS_MAX_*），排布结果必须落在里面。 */
  bounds: { maxX: number; maxY: number }
  nodeSize: { width: number; height: number }
  /** 现有记法的尺寸；缺省用 nodeSize。 */
  sizeOf?: (elementId: string) => { w: number; h: number } | undefined
  strategy?: LayoutChoice
}

export interface LayoutResult {
  placements: Placement[]
  strategy: LayoutStrategy
  axis: LayoutAxis
  /** 关系方向上折了几「行」（蛇形换行），用来说明图面被折了几段。 */
  bands: number
  extent: { width: number; height: number }
}

const MARGIN = 36
/**
 * 拆段与折行的候选尺寸。
 * 一层沿跨轴铺过 crossLimit 就拆成下一段；主轴铺过 majorLimit 就折一行。
 * 两者必须成组试：一段取 1080 宽、折 5 行就要 5880 高，超出文档范围只能硬钳，
 * 钳完就是叠盒子。候选铺开后由打分挑出既不叠、比例又接近视口的那一组。
 */
const LAYOUT_SIZES: { cross: number, major: number }[] = [
  { cross: 600, major: 1400 },
  { cross: 600, major: 2200 },
  { cross: 1080, major: 1400 },
  { cross: 1080, major: 2200 },
  { cross: 1080, major: 3200 },
  { cross: 1680, major: 2200 },
  { cross: 1680, major: 3200 },
  { cross: 1080, major: Number.POSITIVE_INFINITY },
]
/** 层与层之间留给关系通道的距离；同层节点之间贴得紧一些。 */
const GAP_MAJOR = 96
const GAP_MINOR = 36
const GROUP_GAP = 56
/** 图面指标（交叉、重叠）是 O(n²)；超过这个规模只按几何量取舍，避免全项目排布卡住界面。 */
const METRIC_MAX = 900
/** 候选包围盒的目标比例与画布视口一致：越接近，越少缩放平移就能看全。 */
const TARGET_ASPECT = 640 / 420
/** 序列图的记法归生命线自己排（表头 + 生命线），自动排布不动它。 */
export const LAYOUT_IMMUTABLE_KINDS: string[] = ['seq']

interface LayoutNode {
  id: string
  name: string
  w: number
  h: number
}

interface LayoutEdge {
  from: string
  to: string
  /** 是否参与分层：包含与细化说的是归属/分解层次，当成分层依据会把图拉成几十层长链。 */
  layer: boolean
}

interface Graph {
  nodes: LayoutNode[]
  byId: Map<string, LayoutNode>
  edges: LayoutEdge[]
  childrenOf: Map<string, string[]>
}

interface Slot {
  id: string
  width: number
  height: number
}

export function isLayoutImmutable(kind: string): boolean {
  return LAYOUT_IMMUTABLE_KINDS.includes(kind)
}

export function autoLayout(input: LayoutInput): LayoutResult {
  const graph = prepare(input)
  if (graph.nodes.length === 0) {
    return emptyResult('layered', 'right')
  }
  const choice = input.strategy ?? 'auto'
  const wantLayered = choice === 'auto' || choice === 'layered'
  const wantHubbed = choice === 'auto' || choice === 'hubbed'
  const ranks = wantLayered ? orderRanks(graph, rankNodes(graph)) : []
  const layered = wantLayered
    ? LAYOUT_SIZES.flatMap((size) => [
      layoutLayered(graph, ranks, 'right', input.bounds, size),
      layoutLayered(graph, ranks, 'down', input.bounds, size),
    ])
    : []
  const hubbed = wantHubbed
    ? hubCrossLimits(graph, input.bounds).flatMap((cross) => [
      layoutHubbed(graph, 'right', input.bounds, cross),
      layoutHubbed(graph, 'down', input.bounds, cross),
    ])
    : []
  const candidates: LayoutResult[] = choice === 'grouped'
    ? [layoutGrouped(graph, input.bounds)]
    : [...layered, ...hubbed, ...(choice === 'auto' ? [layoutGrouped(graph, input.bounds)] : [])]
  // 任何策略都必须把图上的元素全部安置，缺一个就不采纳（宁可退回另一种排法）。
  const usable = candidates.filter((candidate) => candidate.placements.length === graph.nodes.length)
  if (usable.length === 0) {
    return emptyResult(choice === 'auto' ? 'layered' : choice, 'right')
  }
  // 图面指标是 O(e²)，每个候选只算一次分。
  const scored = usable.map((candidate) => ({ candidate, value: score(candidate, graph, input.bounds) }))
  return scored.reduce((best, entry) => (entry.value < best.value ? entry : best)).candidate
}

function emptyResult(strategy: LayoutStrategy, axis: LayoutAxis): LayoutResult {
  return { placements: [], strategy, axis, bands: 0, extent: { width: 0, height: 0 } }
}

/**
 * 图面质量的可解释打分，越小越好：
 * 重叠与连线交叉（「关系散乱」的直接来源）权重最高，其次比例偏离、占文档面积、折行、超范围。
 * 规模超过 METRIC_MAX 时只算几何项：图面指标是 O(n²)，全项目一次排布不该为此卡住界面。
 */
function score(result: LayoutResult, graph: Graph, bounds: { maxX: number; maxY: number }): number {
  const width = Math.max(result.extent.width, 1)
  const height = Math.max(result.extent.height, 1)
  const sizes = new Map(graph.nodes.map((node) => [node.id, { w: node.w, h: node.h }]))
  const measurable = graph.nodes.length <= METRIC_MAX && graph.edges.length <= METRIC_MAX
  const crossings = !measurable || graph.edges.length === 0
    ? 0
    : crossingsOf(result.placements, sizes, graph.edges)
  const overlaps = !measurable ? 0 : overlapsOf(result.placements, sizes)
  const edgeCount = Math.max(graph.edges.length, 1)
  const crossCost = (crossings / edgeCount) * 4
  // 压叠比交叉更致命：盒子叠在一起时名称和关系都读不出来，权重要把它压到几乎不可选。
  const overlapCost = (overlaps / Math.max(graph.nodes.length, 1)) * 12
  const aspectCost = Math.abs(Math.log(width / height / TARGET_ASPECT)) * 2.2
  // 稀疏惩罚：同样数目的盒子铺得越开越难读——空白会把关系线拉成穿过整张图的长斜线，
  // 交叉数为 0 也可能是张没法看的网，所以密度要单独计一笔。
  const nodeArea = graph.nodes.reduce((sum, node) => sum + node.w * node.h, 0)
  const spreadCost = Math.log(Math.max(width * height, 1) / Math.max(nodeArea, 1)) * 0.6
  const areaCost = (width * height) / Math.max(bounds.maxX * bounds.maxY, 1)
  const bandCost = Math.max(0, result.bands - 1) * 0.3
  const overflow = Math.max(0, width / Math.max(bounds.maxX, 1) - 1)
    + Math.max(0, height / Math.max(bounds.maxY, 1) - 1)
  return crossCost + overlapCost + aspectCost + spreadCost + areaCost + bandCost + overflow * 4
}

/** 矩形盒两两相交的对数：钳进文档范围时最容易堆出来，必须计入代价。 */
function overlapsOf(placements: Placement[], sizes: Map<string, { w: number; h: number }>): number {
  const boxes = placements.map((placement) => {
    const size = sizes.get(placement.elementId) ?? { w: 0, h: 0 }
    return { x1: placement.x, y1: placement.y, x2: placement.x + size.w, y2: placement.y + size.h }
  })
  let count = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
        count++
      }
    }
  }
  return count
}

/** 中心连线的两两相交数：共端点的两条线不算交叉。与渲染器的画线口径一致（两端正方形盒中心）。 */
function crossingsOf(placements: Placement[], sizes: Map<string, { w: number; h: number }>, edges: LayoutEdge[]): number {
  const center = new Map<string, { x: number; y: number }>()
  for (const placement of placements) {
    const size = sizes.get(placement.elementId) ?? { w: 0, h: 0 }
    center.set(placement.elementId, { x: placement.x + size.w / 2, y: placement.y + size.h / 2 })
  }
  const segments = edges
    .map((edge) => ({ from: edge.from, to: edge.to, a: center.get(edge.from), b: center.get(edge.to) }))
    .filter((segment): segment is { from: string, to: string, a: { x: number, y: number }, b: { x: number, y: number } } =>
      segment.a !== undefined && segment.b !== undefined)
  let count = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const left = segments[i]
      const right = segments[j]
      if (left.from === right.from || left.from === right.to || left.to === right.from || left.to === right.to) {
        continue
      }
      if (intersect(left.a, left.b, right.a, right.b)) {
        count++
      }
    }
  }
  return count
}

function orient(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

function intersect(p1: { x: number; y: number }, p2: { x: number; y: number },
  p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  return orient(p3, p4, p1) !== orient(p3, p4, p2) && orient(p1, p2, p3) !== orient(p1, p2, p4)
}

/* ── 输入归一 ── */

function prepare(input: LayoutInput): Graph {
  const onDiagram = new Set(input.elements.map((element) => element.id))
  const nodes: LayoutNode[] = input.elements.map((element) => {
    const measured = input.sizeOf?.(element.id)
    return {
      id: element.id,
      name: element.name ?? element.id,
      w: measured?.w ?? input.nodeSize.width,
      h: measured?.h ?? input.nodeSize.height,
    }
  })
  nodes.sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const order = (a: string, b: string) => {
    const left = byId.get(a)
    const right = byId.get(b)
    return cmp(left?.name ?? a, right?.name ?? b) || cmp(a, b)
  }

  const seen = new Set<string>()
  const edges: LayoutEdge[] = []
  for (const relation of input.relationships) {
    if (relation.sourceId === relation.targetId) {
      continue
    }
    if (!onDiagram.has(relation.sourceId) || !onDiagram.has(relation.targetId)) {
      continue
    }
    const key = `${relation.sourceId}>${relation.targetId}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const type = relation.type.toLowerCase()
    edges.push({
      from: relation.sourceId,
      to: relation.targetId,
      layer: type !== 'containment' && type !== 'refine',
    })
  }

  const childrenOf = new Map<string, string[]>()
  for (const element of input.elements) {
    if (!element.ownerId || !onDiagram.has(element.ownerId) || element.ownerId === element.id) {
      continue
    }
    const list = childrenOf.get(element.ownerId) ?? []
    list.push(element.id)
    childrenOf.set(element.ownerId, list)
  }
  for (const list of childrenOf.values()) {
    list.sort(order)
  }
  return { nodes, byId, edges, childrenOf }
}

/** 名称次序：中文按拼音序比较，保证同一模型每次排布得到同样的图面。 */
function cmp(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN-u-co-pinyin')
}

/* ── layered：分层 + 中位数排序 + 拆段与蛇形折行 ── */

function layoutLayered(graph: Graph, ranks: string[][], axis: LayoutAxis,
  bounds: { maxX: number; maxY: number }, size: { cross: number, major: number }): LayoutResult {
  const sizes = new Map<string, { w: number; h: number }>(
    graph.nodes.map((node) => [node.id, { w: node.w, h: node.h }]),
  )
  const laid = placeRanks(graph, ranks, axis, size.cross, size.major)
  // 报钳制后的真实包围盒：候选比较必须看用户实际会看到的那张图面。
  const placements = clampToDocument(laid.placements, sizes, bounds)
  return {
    placements,
    strategy: 'layered',
    axis,
    bands: laid.bandCount,
    extent: extentOf(placements, sizes),
  }
}

/**
 * 分层：先按拓扑序排出先后，成环的边不参与分层（环上节点按名字补到序列尾部），
 * 再沿剩下的有向边取最长路径作为层号。返回按层分组的节点 id。
 */
function rankNodes(graph: Graph): string[][] {
  const outgoing = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]))
  const indegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]))
  for (const edge of graph.edges) {
    if (!edge.layer) {
      continue
    }
    outgoing.get(edge.from)?.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const order = (a: string, b: string) => cmp(graph.byId.get(a)?.name ?? a, graph.byId.get(b)?.name ?? b) || cmp(a, b)

  const sequence: string[] = []
  const placed = new Set<string>()
  let frontier = graph.nodes.map((node) => node.id).filter((id) => (indegree.get(id) ?? 0) === 0).sort(order)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (placed.has(id)) {
        continue
      }
      placed.add(id)
      sequence.push(id)
      for (const target of outgoing.get(id) ?? []) {
        const left = (indegree.get(target) ?? 0) - 1
        indegree.set(target, left)
        if (left === 0 && !placed.has(target)) {
          next.push(target)
        }
      }
    }
    frontier = next.sort(order)
  }
  // 环上的节点入度永远清不完：按名字补到序列尾部，指向已排前面的边就不参与分层。
  for (const node of graph.nodes) {
    if (!placed.has(node.id)) {
      sequence.push(node.id)
    }
  }

  const position = new Map(sequence.map((id, index) => [id, index]))
  const rank = new Map<string, number>(sequence.map((id) => [id, 0]))
  for (const id of sequence) {
    for (const target of outgoing.get(id) ?? []) {
      if ((position.get(target) ?? 0) <= (position.get(id) ?? 0)) {
        continue
      }
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1))
    }
  }
  const groups: string[][] = Array.from({ length: Math.max(0, ...rank.values()) + 1 }, () => [])
  for (const id of sequence) {
    groups[rank.get(id) ?? 0].push(id)
  }
  return groups
}

/** 层内次序：以拓扑序列起手，正反交替扫四轮，按相邻层的中位数位置排序以减少交叉。 */
function orderRanks(graph: Graph, groups: string[][]): string[][] {
  const neighbours = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) {
    neighbours.get(edge.from)?.push(edge.to)
    neighbours.get(edge.to)?.push(edge.from)
  }
  const result = groups.map((group) => [...group])
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0
    const indexes = forward
      ? Array.from(result.keys()).slice(1)
      : Array.from(result.keys()).slice(1).reverse()
    for (const index of indexes) {
      const reference = result[forward ? index - 1 : index + 1]
      if (!reference || reference.length === 0) {
        continue
      }
      const positionOf = new Map(reference.map((id, position) => [id, position]))
      const keys = new Map<string, number>()
      result[index].forEach((id, position) => {
        const adjacent = (neighbours.get(id) ?? [])
          .map((other) => positionOf.get(other))
          .filter((value): value is number => value !== undefined)
          .sort((a, b) => a - b)
        keys.set(id, adjacent.length > 0 ? adjacent[Math.floor(adjacent.length / 2)] : position)
      })
      result[index] = [...result[index]].sort((a, b) => {
        const byKey = (keys.get(a) ?? 0) - (keys.get(b) ?? 0)
        return byKey || cmp(graph.byId.get(a)?.name ?? a, graph.byId.get(b)?.name ?? b) || cmp(a, b)
      })
    }
  }
  return result
}

interface Slice {
  /** 段内节点及其跨轴偏移。 */
  items: { id: string, cross: number }[]
  crossExtent: number
  majorExtent: number
  /** 该段在本行内的主轴起点。 */
  majorStart: number
}

/**
 * 坐标：层号沿主轴推进，同层节点沿跨轴排开。
 * 一层铺过 crossLimit 拆成下一段（继续沿主轴推进，含义是「同一层的后半截」）；
 * 主轴铺过 majorLimit 折一行，且奇数行反向走 —— 首尾相接的那条线落在同一侧，
 * 不会从上一行的末端横跨整张图回到下一行的开头。
 */
function placeRanks(graph: Graph, groups: string[][], axis: LayoutAxis, crossLimit: number, majorLimit: number):
  { placements: Placement[], bandCount: number } {
  const slices: Slice[] = []
  for (const group of groups) {
    let slice: Slice = { items: [], crossExtent: 0, majorExtent: 0, majorStart: 0 }
    let crossCursor = 0
    const flush = () => {
      if (slice.items.length > 0) {
        slices.push(slice)
      }
      slice = { items: [], crossExtent: 0, majorExtent: 0, majorStart: 0 }
      crossCursor = 0
    }
    for (const id of group) {
      const node = graph.byId.get(id)
      if (!node) {
        continue
      }
      const major = axis === 'right' ? node.w : node.h
      const cross = axis === 'right' ? node.h : node.w
      const nextCross = slice.items.length === 0 ? cross : slice.crossExtent + GAP_MINOR + cross
      if (slice.items.length > 0 && nextCross > crossLimit) {
        flush()
      }
      slice.items.push({ id, cross: crossCursor })
      slice.majorExtent = Math.max(slice.majorExtent, major)
      slice.crossExtent = nextCross
      crossCursor = nextCross + GAP_MINOR
    }
    flush()
  }

  const lanes: Slice[][] = []
  let lane: Slice[] = []
  let majorCursor = 0
  for (const slice of slices) {
    if (lane.length > 0 && majorCursor + slice.majorExtent > majorLimit) {
      lanes.push(lane)
      lane = []
      majorCursor = 0
    }
    slice.majorStart = majorCursor
    lane.push(slice)
    majorCursor = slice.majorStart + slice.majorExtent + GAP_MAJOR
  }
  if (lane.length > 0) {
    lanes.push(lane)
  }

  const laneMajor = lanes.map((row) => Math.max(...row.map((slice) => slice.majorStart + slice.majorExtent)))
  const laneCross = lanes.map((row) => Math.max(...row.map((slice) => slice.crossExtent)))
  const laneStart: number[] = []
  let crossBase = 0
  for (const extent of laneCross) {
    laneStart.push(crossBase)
    crossBase += extent + GAP_MAJOR
  }

  const placements: Placement[] = []
  lanes.forEach((row, index) => {
    const reverse = index % 2 === 1
    for (const slice of row) {
      const offset = (laneCross[index] - slice.crossExtent) / 2
      for (const item of slice.items) {
        const node = graph.byId.get(item.id)!
        const majorSize = axis === 'right' ? node.w : node.h
        const major = slice.majorStart + (slice.majorExtent - majorSize) / 2
        const cross = laneStart[index] + offset + item.cross
        const along = reverse ? laneMajor[index] - major : major
        placements.push({
          elementId: item.id,
          x: Math.round(axis === 'right' ? MARGIN + along : MARGIN + cross),
          y: Math.round(axis === 'right' ? MARGIN + cross : MARGIN + along),
        })
      }
    }
  })
  return { placements, bandCount: lanes.length }
}

/* ── hubbed：中心节点贴边，其余按「主要中心」聚成分块网格 ── */

/** 度数达到均值这个倍数才算中心节点；倍数太低会把半张图都当成中心，退化成普通网格。 */
const HUB_DEGREE_FACTOR = 1.5
const HUB_MIN_DEGREE = 3
/** 中心节点占比高过这个数说明图里没有真正的中心，这种排法不采纳。 */
const HUB_MAX_SHARE = 0.5

/**
 * 用例图这类「几个参与者连一大片用例」的星形结构，分层和分组都只能把它铺成一张网：
 * 参与者混在字段里，二十条线从一个点射出去，穿过别人家的连线。这里把高度数节点摘出来
 * 贴到跨轴起点的一列（行），剩下的按「连到哪个中心最多」成簇排布，每簇占一段，
 * 中心再对齐到自己那簇的中位位置——同一个中心的线聚成一个扇形，彼此不再穿插。
 */
function layoutHubbed(
  graph: Graph,
  axis: LayoutAxis,
  bounds: { maxX: number; maxY: number },
  crossLimit: number,
): LayoutResult {
  const degree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]))
  const neighbours = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    neighbours.get(edge.from)?.push(edge.to)
    neighbours.get(edge.to)?.push(edge.from)
  }
  const nodeCount = graph.nodes.length
  if (nodeCount === 0 || graph.edges.length === 0) {
    return emptyResult('hubbed', axis)
  }
  const minDegree = Math.max(HUB_MIN_DEGREE,
    Math.ceil(HUB_DEGREE_FACTOR * (2 * graph.edges.length / nodeCount)))
  const hubs = graph.nodes
    .filter((node) => (degree.get(node.id) ?? 0) >= minDegree)
    .sort(byDegree(degree))
  if (hubs.length === 0 || hubs.length > Math.ceil(nodeCount * HUB_MAX_SHARE)) {
    return emptyResult('hubbed', axis)
  }
  const hubIds = new Set(hubs.map((node) => node.id))

  // 每个非中心节点归到连它的那个中心里度数最大的那一簇；一个中心都不连的自成一组，排在最后。
  const clusters = new Map<string, string[]>()
  for (const node of graph.nodes) {
    if (hubIds.has(node.id)) {
      continue
    }
    const mine = (neighbours.get(node.id) ?? [])
      .filter((id) => hubIds.has(id))
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || cmp(a, b))
    const key = mine.length > 0 ? mine[0] : ''
    const list = clusters.get(key) ?? []
    list.push(node.id)
    clusters.set(key, list)
  }
  const keys = [...clusters.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || cmp(a, b)
  })
  const groups = keys.map((key) =>
    (clusters.get(key) ?? []).slice().sort((a, b) =>
      cmp(graph.byId.get(a)?.name ?? a, graph.byId.get(b)?.name ?? b) || cmp(a, b)))

  const sizes = new Map(graph.nodes.map((node) => [node.id, { w: node.w, h: node.h }]))
  // 簇内是紧凑网格：沿跨轴铺到 crossLimit 换一行，行距只留一点；簇之间再沿主轴堆叠。
  // 这里不走 placeRanks：那套蛇形折行是给「层」用的，段距按层间通道算，用在簇上会把图面拉成一条走廊。
  const cells: { id: string, cross: number, major: number }[] = []
  let clusterStart = 0
  for (const group of groups) {
    let cursor = 0
    let rowMajor = 0
    for (const id of group) {
      const node = graph.byId.get(id)!
      const crossSize = axis === 'right' ? node.h : node.w
      const majorSize = axis === 'right' ? node.w : node.h
      if (cursor > 0 && cursor + crossSize > crossLimit) {
        clusterStart += rowMajor + GAP_MINOR
        cursor = 0
        rowMajor = 0
      }
      cells.push({ id, cross: cursor, major: clusterStart })
      cursor += crossSize + GAP_MINOR
      rowMajor = Math.max(rowMajor, majorSize)
    }
    clusterStart += rowMajor + GROUP_GAP
  }

  // 字段整体让出中心节点那一列（行）的宽度，中心贴在最外侧。
  const laneSize = Math.max(...hubs.map((node) => (axis === 'right' ? node.h : node.w)))
  const base = MARGIN + laneSize + GAP_MAJOR
  const field: Placement[] = cells.map((cell) => ({
    elementId: cell.id,
    x: Math.round(axis === 'right' ? MARGIN + cell.major : base + cell.cross),
    y: Math.round(axis === 'right' ? base + cell.cross : MARGIN + cell.major),
  }))
  const fieldById = new Map(field.map((placement) => [placement.elementId, placement]))

  // 中心沿主轴对齐到自己邻居的中位位置，再顺序紧凑摆放，避免两个中心叠在一起。
  const wanted = hubs.map((hub) => {
    const adjacent = (neighbours.get(hub.id) ?? [])
      .map((id) => fieldById.get(id))
      .filter((placement): placement is Placement => placement !== undefined)
      .map((placement) => {
        const node = graph.byId.get(placement.elementId)!
        return axis === 'right'
          ? placement.x + node.w / 2
          : placement.y + node.h / 2
      })
      .sort((a, b) => a - b)
    return { hub, want: adjacent.length > 0 ? adjacent[Math.floor(adjacent.length / 2)] : MARGIN }
  }).sort((a, b) => a.want - b.want || (degree.get(b.hub.id) ?? 0) - (degree.get(a.hub.id) ?? 0))

  const hubPlacements: Placement[] = []
  let laneCursor = MARGIN
  for (const entry of wanted) {
    const majorSize = axis === 'right' ? entry.hub.w : entry.hub.h
    const along = Math.max(entry.want - majorSize / 2, laneCursor)
    hubPlacements.push({
      elementId: entry.hub.id,
      x: Math.round(axis === 'right' ? MARGIN + along : MARGIN),
      y: Math.round(axis === 'right' ? MARGIN : MARGIN + along),
    })
    laneCursor = along + majorSize + GAP_MINOR
  }

  const clamped = clampToDocument([...field, ...hubPlacements], sizes, bounds)
  return {
    placements: clamped,
    strategy: 'hubbed',
    axis,
    bands: groups.length,
    extent: extentOf(clamped, sizes),
  }
}

/** 枢纽布局的跨轴宽度候选：按节点总面积开成接近视口比例的方形，再给两档松紧。 */
const HUB_SPREADS = [0.75, 1, 1.35]

function hubCrossLimits(graph: Graph, bounds: { maxX: number; maxY: number }): number[] {
  const area = graph.nodes
    .reduce((sum, node) => sum + (node.w + GAP_MINOR) * (node.h + GAP_MINOR), 0)
  const widest = Math.max(...graph.nodes.map((node) => node.w)) + GAP_MINOR
  const ideal = Math.sqrt(Math.max(area, 1) * TARGET_ASPECT)
  const cap = Math.max(widest, bounds.maxX - MARGIN * 2 - widest)
  return HUB_SPREADS.map((factor) => Math.min(Math.max(ideal * factor, widest), cap))
}

function byDegree(degree: Map<string, number>) {
  return (a: LayoutNode, b: LayoutNode) =>
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    || cmp(a.name, b.name) || cmp(a.id, b.id)
}

/* ── grouped：按父子归属分块，父在上、子在下成排 ── */

function layoutGrouped(graph: Graph, bounds: { maxX: number; maxY: number }): LayoutResult {
  const parentOf = new Map<string, string>()
  for (const [owner, children] of graph.childrenOf) {
    for (const child of children) {
      parentOf.set(child, owner)
    }
  }
  const roots = graph.nodes.filter((node) => !parentOf.has(node.id)).map((node) => node.id)

  const blocks = new Map<string, Slot>()
  const measuring = new Set<string>()
  const measure = (id: string): Slot => {
    const cached = blocks.get(id)
    if (cached) {
      return cached
    }
    const node = graph.byId.get(id)!
    // 父链成环（脏数据）时把这一支当叶子，递归靠 measuring 集合断掉。
    const children = measuring.has(id) ? [] : (graph.childrenOf.get(id) ?? [])
    measuring.add(id)
    const childSlots = children.map(measure)
    const shelves = childSlots.length === 0
      ? []
      : shelfSlots(childSlots, targetWidth(childSlots, GROUP_GAP, bounds), GROUP_GAP)
    measuring.delete(id)
    if (shelves.length === 0) {
      const leaf = { id, width: node.w, height: node.h }
      blocks.set(id, leaf)
      return leaf
    }
    const width = Math.max(...shelves.map((shelf) => shelfWidth(shelf, GROUP_GAP)))
    const height = shelves.reduce((sum, shelf) => sum + Math.max(...shelf.map((slot) => slot.height)), 0)
      + (shelves.length - 1) * GAP_MAJOR
    const block = { id, width: Math.max(node.w, width), height: node.h + GAP_MAJOR + height }
    blocks.set(id, block)
    return block
  }

  for (const root of roots) {
    measure(root)
  }
  // 顶层块 = 无父的元素 + 因成环父链而没被任何顶层块罩住的元素。
  const covered = new Set<string>()
  const collect = (id: string) => {
    if (covered.has(id)) {
      return
    }
    covered.add(id)
    for (const child of graph.childrenOf.get(id) ?? []) {
      collect(child)
    }
  }
  const topLevel = [...roots]
  roots.forEach(collect)
  for (const node of graph.nodes) {
    if (!covered.has(node.id)) {
      measure(node.id)
      topLevel.push(node.id)
      collect(node.id)
    }
  }

  // 顶层块成排的宽度上限：宁可多折几排，也不要铺成一条四十块宽、只能横向拖的长带。
  const topSlots = topLevel.map((id) => blocks.get(id)!)
  const shelves = shelfSlots(topSlots, targetWidth(topSlots, GROUP_GAP * 2, bounds), GROUP_GAP * 2)

  const placements: Placement[] = []
  const sizes = new Map<string, { w: number; h: number }>()
  const placed = new Set<string>()
  const place = (id: string, x: number, y: number) => {
    if (placed.has(id)) {
      return
    }
    placed.add(id)
    const node = graph.byId.get(id)!
    sizes.set(id, { w: node.w, h: node.h })
    placements.push({ elementId: id, x: Math.round(x), y: Math.round(y) })
    const children = (graph.childrenOf.get(id) ?? []).filter((child) => !placed.has(child))
    if (children.length === 0) {
      return
    }
    let rowY = y + node.h + GAP_MAJOR
    const childSlots = children.map(measure)
    for (const shelf of shelfSlots(childSlots, targetWidth(childSlots, GROUP_GAP, bounds), GROUP_GAP)) {
      const width = shelfWidth(shelf, GROUP_GAP)
      let cursor = x + (Math.max(width, node.w) - width) / 2
      for (const slot of shelf) {
        place(slot.id, cursor, rowY)
        cursor += slot.width + GROUP_GAP
      }
      rowY += Math.max(...shelf.map((slot) => slot.height)) + GAP_MAJOR
    }
  }

  let shelfY = MARGIN
  for (const shelf of shelves) {
    let cursor = MARGIN
    for (const slot of shelf) {
      place(slot.id, cursor, shelfY)
      cursor += slot.width + GROUP_GAP * 2
    }
    shelfY += Math.max(...shelf.map((slot) => slot.height)) + GAP_MAJOR
  }
  // 兜底：递归没落位的元素（只可能是成环父链）按顺序补在下方，元素一个都不能丢。
  for (const node of graph.nodes) {
    if (!placed.has(node.id)) {
      place(node.id, MARGIN, shelfY)
      shelfY += node.h + GAP_MAJOR
    }
  }
  const clamped = clampToDocument(placements, sizes, bounds)
  return {
    placements: clamped,
    strategy: 'grouped',
    axis: 'down',
    bands: shelves.length,
    extent: extentOf(clamped, sizes),
  }
}

/**
 * 成排的宽度目标：总面积 S 下取宽 = √(S·目标比例)，让每一块自然铺成接近视口的形状，
 * 而不是固定 1080 宽——四十个节点的包会被拉成一条只能横向拖的长带。
 */
function targetWidth(slots: { width: number, height: number }[], gap: number, bounds: { maxX: number; maxY: number }): number {
  if (slots.length === 0) {
    return 1
  }
  const area = slots.reduce((sum, slot) => sum + (slot.width + gap) * (slot.height + gap), 0)
  const widest = Math.max(...slots.map((slot) => slot.width)) + gap
  const ideal = Math.sqrt(Math.max(area, 1) * TARGET_ASPECT)
  return Math.min(Math.max(ideal, widest), Math.max(1, bounds.maxX - MARGIN * 2))
}

/** 把分块塞进不超过 limit 宽的几排。 */
function shelfSlots<T extends { width: number }>(slots: T[], limit: number, gap: number): T[][] {
  const rows: T[][] = []
  let row: T[] = []
  let width = 0
  for (const slot of slots) {
    const next = row.length === 0 ? slot.width : width + gap + slot.width
    if (row.length > 0 && next > limit) {
      rows.push(row)
      row = [slot]
      width = slot.width
    } else {
      row.push(slot)
      width = next
    }
  }
  if (row.length > 0) {
    rows.push(row)
  }
  return rows
}

function shelfWidth<T extends { width: number }>(slots: T[], gap: number): number {
  return slots.reduce((sum, slot) => sum + slot.width, 0) + Math.max(0, slots.length - 1) * gap
}

/* ── 收尾：范围钳制 ── */

function extentOf(placements: Placement[], sizes: Map<string, { w: number; h: number }>):
  { width: number; height: number } {
  let maxX = 0
  let maxY = 0
  for (const placement of placements) {
    const size = sizes.get(placement.elementId) ?? { w: 0, h: 0 }
    maxX = Math.max(maxX, placement.x + size.w)
    maxY = Math.max(maxY, placement.y + size.h)
  }
  return { width: maxX + MARGIN, height: maxY + MARGIN }
}

/**
 * 钳进文档范围：服务端按同一组边界校验，超范围整条命令会被拒。
 * 极端密集的图宁可压一点间距，也不能让一次排布失败。
 */
function clampToDocument(
  placements: Placement[],
  sizes: Map<string, { w: number; h: number }>,
  bounds: { maxX: number; maxY: number },
): Placement[] {
  return placements.map((placement) => {
    const size = sizes.get(placement.elementId) ?? { w: 0, h: 0 }
    return {
      elementId: placement.elementId,
      x: Math.round(Math.min(Math.max(placement.x, 0), Math.max(0, bounds.maxX - size.w))),
      y: Math.round(Math.min(Math.max(placement.y, 0), Math.max(0, bounds.maxY - size.h))),
    }
  })
}
