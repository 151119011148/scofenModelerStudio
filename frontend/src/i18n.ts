import { useSyncExternalStore } from 'react'

/**
 * 中英文切换的词条层。
 *
 * <p>设计取舍：词条键直接使用中文原文，调用点写成 {@code t('撤销')}。这样既不需要为
 * 两百多条文案另起一套无意义的中文键名（键名一旦脱离原文就很难维护），也能让中文读者
 * 一眼看出这句话出现在界面的哪个位置。英文译文集中在 {@link DICTIONARY} 一处维护。</p>
 *
 * <p>元模型目录（元素类型 / 图类型 / 关系类型 / 属性 / 元类）的双语名由服务端随
 * {@code /api/metamodel/*} 下发 {@code labelEn}，此处只负责按当前语言挑选。</p>
 */

export type Locale = 'zh' | 'en'

export interface LocaleOption {
  code: Locale
  label: string
  short: string
}

/** 语言切换按钮的候选项。 */
export const LOCALES: LocaleOption[] = [
  { code: 'zh', label: '中文', short: '中' },
  { code: 'en', label: 'English', short: 'EN' },
]

const STORAGE_KEY = 'scofen.modeler.locale'

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') {
    return stored
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let currentLocale: Locale = detectLocale()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getLocale(): Locale {
  return currentLocale
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 切换语言并持久化；界面各处通过 useLocale 订阅后自动重渲染。 */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) {
    return
  }
  currentLocale = locale
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  emit()
}

/** 订阅当前语言，返回可渲染的语言状态。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

/**
 * 词条表：键为中文原文，值为中英对照。
 * `{占位符}` 在渲染时按传入变量替换。
 */
export const DICTIONARY: Record<string, { zh: string; en: string }> = {
  /* ── 通用动作 ── */
  '撤销': { zh: '撤销', en: 'Undo' },
  '重做': { zh: '重做', en: 'Redo' },
  '取消': { zh: '取消', en: 'Cancel' },
  '创建': { zh: '创建', en: 'Create' },
  '确认删除': { zh: '确认删除', en: 'Confirm delete' },
  '重命名': { zh: '重命名', en: 'Rename' },
  '重命名图': { zh: '重命名图', en: 'Rename diagram' },
  '退出': { zh: '退出', en: 'Exit' },
  '登出': { zh: '登出', en: 'Sign out' },
  '打开': { zh: '打开', en: 'Open' },
  '已打开': { zh: '已打开', en: 'Opened' },
  '登录': { zh: '登录', en: 'Sign in' },
  '登录中…': { zh: '登录中…', en: 'Signing in…' },
  '是': { zh: '是', en: 'Yes' },
  '否': { zh: '否', en: 'No' },
  '未设置': { zh: '未设置', en: 'Not set' },
  '只读': { zh: '只读', en: 'Read-only' },
  '其他': { zh: '其他', en: 'Other' },
  '通用': { zh: '通用', en: 'Generic' },
  '节点': { zh: '节点', en: 'Nodes' },
  '画布': { zh: '画布', en: 'Canvas' },
  '组件': { zh: '组件', en: 'Components' },
  '样式': { zh: '样式', en: 'Styles' },
  '布局器': { zh: '布局器', en: 'Layout' },
  '属性': { zh: '属性', en: 'Properties' },
  '标签': { zh: '标签', en: 'Tags' },
  '类型': { zh: '类型', en: 'Type' },
  '文档': { zh: '文档', en: 'Documentation' },
  '名称': { zh: '名称', en: 'Name' },
  '状态': { zh: '状态', en: 'Status' },
  '负责人': { zh: '负责人', en: 'Owner' },
  '所有者': { zh: '所有者', en: 'Owner' },
  '所属空间': { zh: '所属空间', en: 'Space' },
  '元素数': { zh: '元素数', en: 'Elements' },
  '元素 / 关系 / 图': { zh: '元素 / 关系 / 图', en: 'Elements / Relationships / Diagrams' },
  '图 / 元素': { zh: '图 / 元素', en: 'Diagrams / Elements' },
  '关系 / 修订': { zh: '关系 / 修订', en: 'Relationships / Revision' },
  '版本 rev': { zh: '版本 rev', en: 'Revision rev' },
  '持久化': { zh: '持久化', en: 'Persistence' },
  '构造型': { zh: '构造型', en: 'Stereotypes' },
  '语义族': { zh: '语义族', en: 'Semantic family' },
  '语义族图例': { zh: '语义族图例', en: 'Semantic family legend' },
  '校验分组': { zh: '校验分组', en: 'Validation group' },
  '图': { zh: '图', en: 'Diagram' },
  '图表': { zh: '图表', en: 'Diagrams' },
  '关系': { zh: '关系', en: 'Relationship' },
  '项目': { zh: '项目', en: 'Projects' },
  '模型库': { zh: '模型库', en: 'Model Library' },
  '工作空间': { zh: '工作空间', en: 'Workspace' },
  '项目根': { zh: '项目根', en: 'Project Root' },
  '模型根': { zh: '模型根', en: 'Model Root' },
  '源': { zh: '源', en: 'Source' },
  '目标': { zh: '目标', en: 'Target' },
  '源元素': { zh: '源元素', en: 'Source element' },
  '目标元素': { zh: '目标元素', en: 'Target element' },

  /* ── 面板与视图 ── */
  '项目名称': { zh: '项目名称', en: 'Project name' },
  '描述（可选）': { zh: '描述（可选）', en: 'Description (optional)' },
  '工作空间与项目': { zh: '工作空间与项目', en: 'Workspace and Projects' },
  '空间详情': { zh: '空间详情', en: 'Space details' },
  '完整面板': { zh: '完整面板', en: 'Full panel' },
  '收起空间面板': { zh: '收起空间面板', en: 'Collapse space panel' },
  '空间与项目导航': { zh: '空间与项目导航', en: 'Space and project navigation' },
  '切换空间与项目': { zh: '切换空间与项目', en: 'Switch space and project' },
  '当前项目': { zh: '当前项目', en: 'Current project' },
  '当前编辑项目': { zh: '当前编辑项目', en: 'Current project' },
  '当前图': { zh: '当前图', en: 'Current diagram' },
  '未命名项目': { zh: '未命名项目', en: 'Untitled project' },
  '未选择图': { zh: '未选择图', en: 'No diagram selected' },
  '未选择对象': { zh: '未选择对象', en: 'No object selected' },
  '模型概要': { zh: '模型概要', en: 'Model summary' },
  '模型浏览器 · 右键操作': { zh: '模型浏览器 · 右键操作', en: 'Model browser · right-click for actions' },
  '模型浏览器 · {name}': { zh: '模型浏览器 · {name}', en: 'Model browser · {name}' },
  '属性窗口（常驻左下角）': { zh: '属性窗口（常驻左下角）', en: 'Properties (docked bottom-left)' },
  '组件工具箱（模型树右侧）': { zh: '组件工具箱（模型树右侧）', en: 'Component toolbox (right of the tree)' },
  '常驻 · 左下角': { zh: '常驻 · 左下角', en: 'Docked · bottom-left' },
  '属性档位': { zh: '属性档位', en: 'Property levels' },
  '标准': { zh: '标准', en: 'Standard' },
  '专家': { zh: '专家', en: 'Expert' },
  '全部': { zh: '全部', en: 'All' },
  '最常用属性': { zh: '最常用属性', en: 'Most common properties' },
  '规范扩展属性': { zh: '规范扩展属性', en: 'Specification extensions' },
  '含派生只读属性': { zh: '含派生只读属性', en: 'Includes derived read-only' },
  '项目根节点 · 不可删除': { zh: '项目根节点 · 不可删除', en: 'Project root · cannot be deleted' },
  '项目根节点模型不可删除': { zh: '项目根节点模型不可删除', en: 'The project root model cannot be deleted' },
  '项目根节点模型，不可删除': { zh: '项目根节点模型，不可删除', en: 'Project root model, cannot be deleted' },

  /* ── 新建 / 删除 ── */
  '新建项目': { zh: '新建项目', en: 'New project' },
  '新建元素': { zh: '新建元素', en: 'New element' },
  '新建元素…': { zh: '新建元素…', en: 'New element…' },
  '新建子元素…': { zh: '新建子元素…', en: 'New child element…' },
  '新建图': { zh: '新建图', en: 'New diagram' },
  '新建图…': { zh: '新建图…', en: 'New diagram…' },
  '新建关系': { zh: '新建关系', en: 'New relationship' },
  '新建关系…': { zh: '新建关系…', en: 'New relationship…' },
  '在此新建图…': { zh: '在此新建图…', en: 'New diagram here…' },
  '在项目根下新建元素…': { zh: '在项目根下新建元素…', en: 'New element under the project root…' },
  '在项目根下新建图…': { zh: '在项目根下新建图…', en: 'New diagram under the project root…' },
  '删除元素': { zh: '删除元素', en: 'Delete element' },
  '删除关系': { zh: '删除关系', en: 'Delete relationship' },
  '删除图': { zh: '删除图', en: 'Delete diagram' },
  '删除该关系（可通过撤销恢复）': { zh: '删除该关系（可通过撤销恢复）', en: 'Delete this relationship (recoverable via Undo)' },
  '加入当前图': { zh: '加入当前图', en: 'Add to current diagram' },
  '把选中元素加入当前图': { zh: '把选中元素加入当前图', en: 'Add the selected element to the current diagram' },
  '在图中定位': { zh: '在图中定位', en: 'Locate in diagram' },
  '导出 SVG': { zh: '导出 SVG', en: 'Export SVG' },
  '名称（同命名空间内唯一，不区分大小写）': {
    zh: '名称（同命名空间内唯一，不区分大小写）',
    en: 'Name (unique within the namespace, case-insensitive)',
  },
  '图名称': { zh: '图名称', en: 'Diagram name' },
  '图类型': { zh: '图类型', en: 'Diagram type' },
  '元素类型（按规范过滤）': { zh: '元素类型（按规范过滤）', en: 'Element types (filtered by spec)' },
  '关系类型': { zh: '关系类型', en: 'Relationship type' },
  '关系向导（选两端）…': { zh: '关系向导（选两端）…', en: 'Relationship wizard (pick endpoints)…' },
  '— 选择源 —': { zh: '— 选择源 —', en: '— Select source —' },
  '— 选择目标 —': { zh: '— 选择目标 —', en: '— Select target —' },
  ' 将级联删除 {count} 个后代元素、相关关系与图形记法。': {
    zh: ' 将级联删除 {count} 个后代元素、相关关系与图形记法。',
    en: ' This also deletes {count} descendant elements, related relationships and notations.',
  },
  '（含 {count} 个后代）': { zh: '（含 {count} 个后代）', en: ' (with {count} descendants)' },

  /* ── 提示与说明 ── */
  '暂无描述': { zh: '暂无描述', en: 'No description' },
  '暂无元素，右键空白处新建元素': { zh: '暂无元素，右键空白处新建元素', en: 'No elements — right-click empty space to create one' },
  '暂无关系': { zh: '暂无关系', en: 'No relationships' },
  '暂无标签值': { zh: '暂无标签值', en: 'No tagged values' },
  '当前图暂无元素': { zh: '当前图暂无元素', en: 'No elements in the current diagram' },
  '正在加载空间目录…': { zh: '正在加载空间目录…', en: 'Loading space directory…' },
  '空间目录加载中…': { zh: '空间目录加载中…', en: 'Loading space directory…' },
  '点击项目即可打开 · 新建后自动打开': {
    zh: '点击项目即可打开 · 新建后自动打开',
    en: 'Click a project to open it · new projects open automatically',
  },
  '点击项目即可打开并编辑；M0 内存态模型在服务重启后回到初始基线。': {
    zh: '点击项目即可打开并编辑；M0 内存态模型在服务重启后回到初始基线。',
    en: 'Click a project to open and edit it; the in-memory M0 model resets to the baseline on restart.',
  },
  '创建后会立即打开该项目并分配独立的内存态模型；服务重启后回到初始基线。': {
    zh: '创建后会立即打开该项目并分配独立的内存态模型；服务重启后回到初始基线。',
    en: 'The project opens immediately with its own in-memory model; a server restart resets it to the baseline.',
  },
  '在指定空间下创建并立即打开项目': {
    zh: '在指定空间下创建并立即打开项目',
    en: 'Create a project in the chosen space and open it immediately',
  },
  '服务端以单条原子命令完成，所有在线会话同步；可用「撤销」恢复整棵子树。': {
    zh: '服务端以单条原子命令完成，所有在线会话同步；可用「撤销」恢复整棵子树。',
    en: 'The server applies it as one atomic command, synced to all sessions; Undo restores the whole subtree.',
  },
  '新建元素 / 新建图 / 关系向导在此；元素与关系组件随当前图联动。': {
    zh: '新建元素 / 新建图 / 关系向导在此；元素与关系组件随当前图联动。',
    en: 'New element, new diagram and the relationship wizard live here; components follow the current diagram.',
  },
  '「组件」工具箱已按当前图过滤：': {
    zh: '「组件」工具箱已按当前图过滤：',
    en: 'The "Components" toolbox is filtered by the current diagram: ',
  },
  '按当前图规范过滤；选中关系后在画布点起点、再点终点即可连线': {
    zh: '按当前图规范过滤；选中关系后在画布点起点、再点终点即可连线',
    en: 'Filtered by the current diagram spec; pick a relationship, then click the source and target on the canvas',
  },
  '按元模型规则，该父类型不允许再包含子元素。': {
    zh: '按元模型规则，该父类型不允许再包含子元素。',
    en: 'By the metamodel rules this parent type cannot contain child elements.',
  },
  '该元素类型不允许出现在当前图，服务端会拒绝；仅创建到模型树中。': {
    zh: '该元素类型不允许出现在当前图，服务端会拒绝；仅创建到模型树中。',
    en: 'This element type is not allowed in the current diagram and the server will reject it; it is created in the model tree only.',
  },
  '该类型暂无属性定义（属性目录加载中或服务端未登记）': {
    zh: '该类型暂无属性定义（属性目录加载中或服务端未登记）',
    en: 'No properties defined for this type (catalog still loading, or not registered by the server)',
  },
  '在左侧模型树或画布中选择一个元素、关系或图': {
    zh: '在左侧模型树或画布中选择一个元素、关系或图',
    en: 'Select an element, relationship or diagram in the model tree or on the canvas',
  },
  '选择一个模型元素或关系以查看其构造型、文档与标签值': {
    zh: '选择一个模型元素或关系以查看其构造型、文档与标签值',
    en: 'Select an element or relationship to view its stereotypes, documentation and tagged values',
  },
  '模型画布，图形可拖拽；连线模式下依次点击起点与终点': {
    zh: '模型画布，图形可拖拽；连线模式下依次点击起点与终点',
    en: 'Model canvas — drag shapes; in relation mode click the source then the target',
  },
  '拖拽图形可移动位置 · 关系以连线呈现（含类型箭头与标签）· 端口贴附所属块边框 · 坐标由服务端记法对象保存并广播给所有会话': {
    zh: '拖拽图形可移动位置 · 关系以连线呈现（含类型箭头与标签）· 端口贴附所属块边框 · 坐标由服务端记法对象保存并广播给所有会话',
    en: 'Drag shapes to move them · relationships render as edges with type arrows and labels · ports attach to the owning block border · coordinates are stored in server-side notation objects and broadcast to all sessions',
  },
  '记法样式由服务端 Notation 对象保存；图形坐标经 WS Patch 广播给所有会话。': {
    zh: '记法样式由服务端 Notation 对象保存；图形坐标经 WS Patch 广播给所有会话。',
    en: 'Notation styling lives in server-side Notation objects; coordinates are broadcast to all sessions over WS patches.',
  },
  '例如：制动系统模型': { zh: '例如：制动系统模型', en: 'e.g. Brake system model' },
  '一句话说明项目范围': { zh: '一句话说明项目范围', en: 'One line describing the project scope' },

  /* ── 运行时消息 ── */
  '正在连接服务端…': { zh: '正在连接服务端…', en: 'Connecting to the server…' },
  '已同步至服务端': { zh: '已同步至服务端', en: 'Synced with the server' },
  '连接失败：{error}': { zh: '连接失败：{error}', en: 'Connection failed: {error}' },
  '图规格加载失败：{error}': { zh: '图规格加载失败：{error}', en: 'Failed to load diagram specs: {error}' },
  '关系目录加载失败：{error}': { zh: '关系目录加载失败：{error}', en: 'Failed to load the relationship catalog: {error}' },
  '元模型规则加载失败：{error}': { zh: '元模型规则加载失败：{error}', en: 'Failed to load metamodel rules: {error}' },
  '属性目录加载失败：{error}': { zh: '属性目录加载失败：{error}', en: 'Failed to load the property catalog: {error}' },
  '操作失败：{error}': { zh: '操作失败：{error}', en: 'Operation failed: {error}' },
  '撤销失败：{error}': { zh: '撤销失败：{error}', en: 'Undo failed: {error}' },
  '重做失败：{error}': { zh: '重做失败：{error}', en: 'Redo failed: {error}' },
  '新建项目失败：{error}': { zh: '新建项目失败：{error}', en: 'Failed to create the project: {error}' },
  '已应用 rev {revision} · {count} 个对象受影响 · 校验：{delta}': {
    zh: '已应用 rev {revision} · {count} 个对象受影响 · 校验：{delta}',
    en: 'Applied rev {revision} · {count} objects affected · validation: {delta}',
  },
  '已撤销至 rev {revision}': { zh: '已撤销至 rev {revision}', en: 'Undone to rev {revision}' },
  '已重做至 rev {revision}': { zh: '已重做至 rev {revision}', en: 'Redone to rev {revision}' },
  '没有可撤销的操作 · Ctrl/⌘ + Z': {
    zh: '没有可撤销的操作 · Ctrl/⌘ + Z',
    en: 'Nothing to undo · Ctrl/⌘ + Z',
  },
  '没有可重做的操作 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y': {
    zh: '没有可重做的操作 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y',
    en: 'Nothing to redo · Ctrl/⌘ + Shift + Z or Ctrl + Y',
  },
  '撤销 · Ctrl/⌘ + Z': { zh: '撤销 · Ctrl/⌘ + Z', en: 'Undo · Ctrl/⌘ + Z' },
  '重做 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y': {
    zh: '重做 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y',
    en: 'Redo · Ctrl/⌘ + Shift + Z or Ctrl + Y',
  },
  '退出登录': { zh: '退出登录', en: 'Sign out' },
  '请填写元素名称并选择类型': { zh: '请填写元素名称并选择类型', en: 'Enter an element name and pick a type' },
  '请填写图名称并选择类型': { zh: '请填写图名称并选择类型', en: 'Enter a diagram name and pick a type' },
  '请选择关系的两端元素': { zh: '请选择关系的两端元素', en: 'Choose both endpoints of the relationship' },
  '「{label}」需要数字，已忽略本次输入': {
    zh: '「{label}」需要数字，已忽略本次输入',
    en: '"{label}" requires a number; the input was ignored',
  },
  '「{label}」需要自然数或 *，已忽略本次输入': {
    zh: '「{label}」需要自然数或 *，已忽略本次输入',
    en: '"{label}" requires a natural number or *; the input was ignored',
  },
  '「{label}」只能取：{options}': {
    zh: '「{label}」只能取：{options}',
    en: '"{label}" accepts only: {options}',
  },
  '「标记值」需要 JSON 对象，例如 {"owner":"张三"}': {
    zh: '「标记值」需要 JSON 对象，例如 {"owner":"张三"}',
    en: '"Tagged values" requires a JSON object, e.g. {"owner":"Zhang San"}',
  },
  '已退出连线模式': { zh: '已退出连线模式', en: 'Exited relation mode' },
  '已选择「{relation}」：在画布上依次点击起点与终点（Esc 退出）': {
    zh: '已选择「{relation}」：在画布上依次点击起点与终点（Esc 退出）',
    en: 'Selected "{relation}": click the source then the target on the canvas (Esc to cancel)',
  },
  '起点：{name}；请点击终点元素': {
    zh: '起点：{name}；请点击终点元素',
    en: 'Source: {name}; now click the target element',
  },
  '已取消起点，请重新选择起点元素': {
    zh: '已取消起点，请重新选择起点元素',
    en: 'Source cleared; pick the source element again',
  },
  '已创建 «{relation}» 关系，可继续连线或按 Esc 退出': {
    zh: '已创建 «{relation}» 关系，可继续连线或按 Esc 退出',
    en: 'Created a «{relation}» relationship; keep drawing or press Esc',
  },
  '「{element}」已在「{diagram}」中，已切换到该图': {
    zh: '「{element}」已在「{diagram}」中，已切换到该图',
    en: '"{element}" is already in "{diagram}"; switched to that diagram',
  },
  '已把「{element}」加入「{diagram}」并落在 ({x}, {y})': {
    zh: '已把「{element}」加入「{diagram}」并落在 ({x}, {y})',
    en: 'Added "{element}" to "{diagram}" at ({x}, {y})',
  },
  '已在 ({x}, {y}) 放置「{name}」': {
    zh: '已在 ({x}, {y}) 放置「{name}」',
    en: 'Placed "{name}" at ({x}, {y})',
  },
  '已把「{name}」放置在 ({x}, {y})': {
    zh: '已把「{name}」放置在 ({x}, {y})',
    en: 'Placed "{name}" at ({x}, {y})',
  },
  '已定位到「{diagram}」': { zh: '已定位到「{diagram}」', en: 'Located in "{diagram}"' },
  '该元素尚未加入任何图，可用右键「加入当前图」': {
    zh: '该元素尚未加入任何图，可用右键「加入当前图」',
    en: 'This element is not in any diagram yet — use right-click → "Add to current diagram"',
  },
  '当前编辑项目：{name}': { zh: '当前编辑项目：{name}', en: 'Current project: {name}' },
  '已打开项目「{name}」· {space}': {
    zh: '已打开项目「{name}」· {space}',
    en: 'Opened project "{name}" · {space}',
  },
  '已创建并打开项目「{name}」': {
    zh: '已创建并打开项目「{name}」',
    en: 'Created and opened project "{name}"',
  },
  '新建{label} {count}': { zh: '新建{label} {count}', en: 'New {label} {count}' },
  '新建图 {count}': { zh: '新建图 {count}', en: 'New diagram {count}' },
  '在{space}新建项目': { zh: '在{space}新建项目', en: 'New project in {space}' },
  '{diagrams} 图 · {elements} 元素 · rev {revision}': {
    zh: '{diagrams} 图 · {elements} 元素 · rev {revision}',
    en: '{diagrams} diagrams · {elements} elements · rev {revision}',
  },
  '尚未打开 · 点击打开': { zh: '尚未打开 · 点击打开', en: 'Not opened · click to open' },
  '尚未打开 · {owner}': { zh: '尚未打开 · {owner}', en: 'Not opened · {owner}' },
  '{label} · 可拖入画布或图节点': {
    zh: '{label} · 可拖入画布或图节点',
    en: '{label} · drag onto the canvas or a diagram node',
  },
  '图 · 点击切换 · 可接收拖入的元素': {
    zh: '图 · 点击切换 · 可接收拖入的元素',
    en: 'Diagram · click to switch · accepts dragged elements',
  },
  '折叠': { zh: '折叠', en: 'Collapse' },
  '展开': { zh: '展开', en: 'Expand' },
  '«{stereotype}» {label} · {uml}｜点击或拖入画布': {
    zh: '«{stereotype}» {label} · {uml}｜点击或拖入画布',
    en: '«{stereotype}» {label} · {uml} | click or drag onto the canvas',
  },
  '«{stereotype}» {label}｜点选后在画布依次点击起点与终点': {
    zh: '«{stereotype}» {label}｜点选后在画布依次点击起点与终点',
    en: '«{stereotype}» {label} | click it, then pick the source and target on the canvas',
  },
  '{relation}：{source} → {target}｜点击查看 / 编辑关系属性': {
    zh: '{relation}：{source} → {target}｜点击查看 / 编辑关系属性',
    en: '{relation}: {source} → {target} | click to view / edit the relationship properties',
  },
  '关系 · {relation}': { zh: '关系 · {relation}', en: 'Relationship · {relation}' },
  '选中源元素': { zh: '选中源元素', en: 'Select the source element' },
  '选中目标元素': { zh: '选中目标元素', en: 'Select the target element' },
  '● 在线': { zh: '● 在线', en: '● Online' },
  '○ 未连接': { zh: '○ 未连接', en: '○ Offline' },
  '逗号分隔': { zh: '逗号分隔', en: 'Comma separated' },
  ' · 只读': { zh: ' · 只读', en: ' · Read-only' },
  '{metaclass} · {umlName} · {spec}{readOnly}': {
    zh: '{metaclass} · {umlName} · {spec}{readOnly}',
    en: '{metaclass} · {umlName} · {spec}{readOnly}',
  },
  '｜点击查看 / 编辑关系属性': {
    zh: '｜点击查看 / 编辑关系属性',
    en: ' | click to view / edit the relationship properties',
  },
  '已同步至服务端 · rev {revision} · 在线会话 {sessions} · Ctrl/⌘+Z 撤销 / Ctrl+Y 重做': {
    zh: '已同步至服务端 · rev {revision} · 在线会话 {sessions} · Ctrl/⌘+Z 撤销 / Ctrl+Y 重做',
    en: 'Synced with the server · rev {revision} · {sessions} online sessions · Ctrl/⌘+Z undo / Ctrl+Y redo',
  },
  '· 连线中 «{relation}»（Esc 退出）': {
    zh: '· 连线中 «{relation}»（Esc 退出）',
    en: '· linking «{relation}» (Esc to cancel)',
  },
  '连线 «{relation}» · {hint} · Esc 退出': {
    zh: '连线 «{relation}» · {hint} · Esc 退出',
    en: 'Linking «{relation}» · {hint} · Esc to cancel',
  },
  '· 连线中 «{relation}»（Esc 退出） ': { zh: '· 连线中 «{relation}»（Esc 退出） ', en: '· linking «{relation}» (Esc to cancel) ' },
  '类元素 ·': { zh: '类元素 ·', en: 'Class elements ·' },
  '类关系': { zh: '类关系', en: 'relationships' },
  '{count} 个对象受影响': { zh: '{count} 个对象受影响', en: '{count} objects affected' },
  '· rev {revision}': { zh: '· rev {revision}', en: '· rev {revision}' },
  '：{source} → {target}': { zh: '：{source} → {target}', en: ': {source} → {target}' },
  '「{label}」需要 JSON 对象，例如 {"owner":"张三"}': {
    zh: '「{label}」需要 JSON 对象，例如 {"owner":"张三"}',
    en: '"{label}" requires a JSON object, e.g. {"owner":"Zhang San"}',
  },
  '点击终点元素': { zh: '点击终点元素', en: 'Click the target element' },
  '点击起点元素': { zh: '点击起点元素', en: 'Click the source element' },
  'SysML 1.6 · 九图': { zh: 'SysML 1.6 · 九图', en: 'SysML 1.6 · Nine views' },

  /* ── 语义族与关系族 ── */
  '命名空间 / 剖面': { zh: '命名空间 / 剖面', en: 'Namespace / Profile' },
  '需求': { zh: '需求', en: 'Requirement' },
  '结构 / 约束': { zh: '结构 / 约束', en: 'Structure / Constraint' },
  '活动': { zh: '活动', en: 'Activity' },
  '交互': { zh: '交互', en: 'Interaction' },
  '状态机': { zh: '状态机', en: 'State Machine' },
  '用例': { zh: '用例', en: 'Use Case' },
  '注释': { zh: '注释', en: 'Annotation' },
  '需求追溯': { zh: '需求追溯', en: 'Requirement traceability' },
  '命名空间': { zh: '命名空间', en: 'Namespace' },
  '结构 / 流': { zh: '结构 / 流', en: 'Structure / Flow' },
  '参数 / 约束': { zh: '参数 / 约束', en: 'Parameter / Constraint' },

  /* ── 登录页 ── */
  '用户名': { zh: '用户名', en: 'Username' },
  '密码': { zh: '密码', en: 'Password' },
  '超管账号': { zh: '超管账号', en: 'Admin accounts' },
  '超管账号：scofen 或 gaofeng': { zh: '超管账号：scofen 或 gaofeng', en: 'Admin account: scofen or gaofeng' },
  '请输入密码': { zh: '请输入密码', en: 'Enter the password' },
  '显示密码': { zh: '显示密码', en: 'Show password' },
  '隐藏密码': { zh: '隐藏密码', en: 'Hide password' },
  '显示': { zh: '显示', en: 'Show' },
  '隐藏': { zh: '隐藏', en: 'Hide' },
  '显示密码，核对输入内容': { zh: '显示密码，核对输入内容', en: 'Show the password to check what you typed' },
  '请填写用户名和密码': { zh: '请填写用户名和密码', en: 'Enter both username and password' },
  '密码含全角或非英文字符，请切换到英文输入法后重新输入': {
    zh: '密码含全角或非英文字符，请切换到英文输入法后重新输入',
    en: 'The password contains full-width or non-ASCII characters — switch to an English keyboard layout and retype it',
  },
  '用户名或密码不正确': { zh: '用户名或密码不正确', en: 'Incorrect username or password' },
  '用户名或密码不正确：账号是 scofen 或 gaofeng（均全小写），密码区分大小写。若浏览器自动填充了其它站点的账号，请清空两个输入框后手动填写。': {
    zh: '用户名或密码不正确：账号是 scofen 或 gaofeng（均全小写），密码区分大小写。若浏览器自动填充了其它站点的账号，请清空两个输入框后手动填写。',
    en: 'Incorrect username or password: the accounts are scofen or gaofeng (both lowercase) and the password is case-sensitive. If the browser auto-filled credentials from another site, clear both fields and type them manually.',
  },
  '（均全小写），共用同一口令且区分大小写。': {
    zh: '（均全小写），共用同一口令且区分大小写。',
    en: ' (both lowercase) share one password, which is case-sensitive.',
  },
  '本实例已关闭自助注册；登录后方可读写模型、图与项目。': {
    zh: '本实例已关闭自助注册；登录后方可读写模型、图与项目。',
    en: 'Self-registration is disabled on this instance; sign in to read and write models, diagrams and projects.',
  },

  /* ── 引用型属性与树上高亮 ── */
  '树上高亮': { zh: '树上高亮', en: 'Highlight in tree' },
  '已在模型树中定位': { zh: '已在模型树中定位', en: 'Located in the model tree' },
  '已在模型树中定位「{name}」': {
    zh: '已在模型树中定位「{name}」',
    en: 'Located "{name}" in the model tree',
  },
  '未引用的元素': { zh: '未引用的元素', en: 'Unresolved element' },
  '引用': { zh: '引用', en: 'Reference' },
  '添加引用': { zh: '添加引用', en: 'Add reference' },
  '移除': { zh: '移除', en: 'Remove' },
  '添加': { zh: '添加', en: 'Add' },
  '右键可树上高亮': { zh: '右键可树上高亮', en: 'Right-click to highlight in the tree' },
  '没有可引用的元素': { zh: '没有可引用的元素', en: 'No element available to reference' },
  '或直接输入元素 id': { zh: '或直接输入元素 id', en: 'or type an element id directly' },
  '空列表': { zh: '空列表', en: 'Empty list' },
  '输入后回车添加': { zh: '输入后回车添加', en: 'Type and press Enter to add' },
  '更换': { zh: '更换', en: 'Change' },
  '选择引用': { zh: '选择引用', en: 'Choose a reference' },

  /* ── 目录与计数 ── */
  '个人空间': { zh: '个人空间', en: 'Personal space' },
  '{count} 成员': { zh: '{count} 成员', en: '{count} members' },
  '{count} 元素 · {relations} 关系': {
    zh: '{count} 元素 · {relations} 关系',
    en: '{count} elements · {relations} relationships',
  },
  '图 · {label}': { zh: '图 · {label}', en: 'Diagram · {label}' },
  ' · 关系 «{type}» · {count} 个元类': {
    zh: ' · 关系 «{type}» · {count} 个元类',
    en: ' · Relationship «{type}» · {count} metaclasses',
  },
  ' · {count} 个元类': { zh: ' · {count} 个元类', en: ' · {count} metaclasses' },
  '{relation}（«{code}»）': { zh: '{relation}（«{code}»）', en: '{relation} («{code}»)' },
  '{label}（«{code}»）': { zh: '{label}（«{code}»）', en: '{label} («{code}»)' },
  '切换当前图；组件内容随之联动': {
    zh: '切换当前图；组件内容随之联动',
    en: 'Switch the current diagram; the toolbox follows it',
  },
  '元素 · {label}': { zh: '元素 · {label}', en: 'Elements · {label}' },
  '仅显示当前图允许的 {count} 类元素 · 点击 / 拖入画布': {
    zh: '仅显示当前图允许的 {count} 类元素 · 点击 / 拖入画布',
    en: 'Only the {count} element types allowed in the current diagram · click or drag onto the canvas',
  },
  '连线中 · «{relation}»': { zh: '连线中 · «{relation}»', en: 'Linking · «{relation}»' },
  ' · 连线中 «{relation}»（Esc 退出）': {
    zh: ' · 连线中 «{relation}»（Esc 退出）',
    en: ' · linking «{relation}» (Esc to cancel)',
  },
  '删除': { zh: '删除', en: 'Delete' },
  '父节点：{name}': { zh: '父节点：{name}', en: 'Parent: {name}' },
  '所属：{name}': { zh: '所属：{name}', en: 'Owner: {name}' },
  '«{stereotype}» {label}（{uml}）': {
    zh: '«{stereotype}» {label}（{uml}）',
    en: '«{stereotype}» {label} ({uml})',
  },
  '同时加入当前图（{label}）': {
    zh: '同时加入当前图（{label}）',
    en: 'Also add to the current diagram ({label})',
  },
  '在「{label}」中建立语义关系 · 类型按当前图规范过滤': {
    zh: '在「{label}」中建立语义关系 · 类型按当前图规范过滤',
    en: 'Create a semantic relationship in "{label}" · filtered by the current diagram spec',
  },
  '确认删除「{name}」？': { zh: '确认删除「{name}」？', en: 'Delete "{name}"?' },
  '{count} 个': { zh: '{count} 个', en: '{count}' },
  '{name}（{type}）': { zh: '{name}（{type}）', en: '{name} ({type})' },
}

/** 语言包缺失时回退到中文原文，保证界面永远可读。 */
function fallback(label: string): string {
  return label
}

/**
 * 按当前语言渲染词条，并替换 {占位符}。
 *
 * <p>{@code t} 是模块级稳定函数：它在调用时读取当前语言，而不是在渲染时捕获。
 * 因此它可以安全地出现在事件回调、useMemo 与 useCallback 里而无需列入依赖数组，
 * 切语言后回调立即使用新语言。</p>
 */
export function t(label: string, vars?: Record<string, unknown>): string {
  const entry = DICTIONARY[label]
  const template = entry ? entry[currentLocale] : fallback(label)
  if (!vars) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

/**
 * 元模型目录的双语标签挑选：服务端同时下发 label（中文）与 labelEn（英文），
 * 英文缺失时回退到中文。同样是稳定函数，读取调用时的当前语言。
 */
export function pick(zh: string | undefined, en: string | undefined): string {
  if (currentLocale === 'en' && en) {
    return en
  }
  return zh ?? en ?? ''
}

/** 界面统一的翻译入口：返回当前语言的词条文本。 */
export function useI18n(): {
  locale: Locale
  t: (label: string, vars?: Record<string, unknown>) => string
  pick: (zh: string | undefined, en: string | undefined) => string
  setLocale: (locale: Locale) => void
} {
  const locale = useLocale()
  return { locale, t, pick, setLocale }
}
