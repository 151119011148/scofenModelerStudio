import type { ModelElement } from './types'

/**
 * 用户定制对象（自定义图类型 / 构造型 / 标签定义）的类型判定与属性读取。
 *
 * <p>元素的 {@code type} 字段存的是创建时的原始字符串，可能是枚举名（{@code DIAGRAM_TYPE}），
 * 也可能是 UML 名（{@code DiagramType}）——两条路径都出现过（前端创建走 umlName，
 * 批量导入走枚举名）。判定必须两种都认，否则同一类定制对象在两个入口会表现不一致。</p>
 */

/** 定制属性键前缀，与服务端 {@code Customization.PREFIX} 一致。 */
export const CUSTOM_PREFIX = 'custom:'

function matches(element: ModelElement, ...names: string[]): boolean {
  const type = (element.type ?? '').toLowerCase()
  return names.some((name) => name.toLowerCase() === type)
}

/** 自定义图类型定义元素。 */
export function isDiagramType(element: ModelElement): boolean {
  return matches(element, 'DIAGRAM_TYPE', 'DiagramType')
}

/** 构造型元素（规范扩展包里的构造型与用户自建的构造型都是它）。 */
export function isStereotype(element: ModelElement): boolean {
  return matches(element, 'STEREOTYPE', 'Stereotype')
}

/** 标签定义元素（挂在构造型之下）。 */
export function isTagDefinition(element: ModelElement): boolean {
  return matches(element, 'TAG_DEFINITION', 'TagDefinition')
}

/** 元类元素（扩展图里由「元类」组件创建）。 */
export function isMetaclass(element: ModelElement): boolean {
  return matches(element, 'METACLASS', 'Metaclass')
}

/** 分类器属性（构造型 / 元类下的 Property 子元素）。 */
export function isProperty(element: ModelElement): boolean {
  return matches(element, 'PROPERTY', 'Property')
}

/** 从属性包里读字符串（定制属性以字符串形态往返）。 */
export function propText(element: ModelElement, key: string): string {
  const value = element.properties?.[key]
  return value == null ? '' : String(value)
}

/**
 * 从属性包里读列表。
 *
 * <p>快照往返后列表仍是数组；但侧车 / 手工导入偶尔以 JSON 字符串形态出现
 * （{@code ["A","B"]}），这里两种都解析。</p>
 */
export function propList(element: ModelElement, key: string): string[] {
  const value = element.properties?.[key]
  if (Array.isArray(value)) {
    return value.map(String)
  }
  if (value == null) {
    return []
  }
  const text = String(value).trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return parsed.map(String)
      }
    } catch { /* 落到单值处理 */ }
  }
  return text ? [text] : []
}

/**
 * 类型名归一：只留字母数字并转小写。
 *
 * <p>同一个类型可能有两种写法——枚举名（{@code BLOCK}）与 UML 名（{@code Block}），
 * 关系类型还有驼峰式（{@code derivereqt}）。白名单比对必须按归一后的形式做，
 * 否则「勾上却没生效」「勾选框全灭」这类问题会反复出现。</p>
 */
export function normalizeTypeName(name: string): string {
  return (name ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

/** 列表里是否包含某个类型（按归一形式比对）。 */
export function listHasType(list: string[], code: string): boolean {
  const target = normalizeTypeName(code)
  return list.some((item) => normalizeTypeName(item) === target)
}
