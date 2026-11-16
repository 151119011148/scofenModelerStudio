/**
 * 扩展域的 id 命名空间（与服务端 {@code ExtensionLibrary.RESERVED_ID_PREFIXES} 一致）。
 *
 * <p>扩展包里的元类 / 构造型 / 关系物化元素都落在这些前缀下；用户自建元素用 {@code e-} 家族，
 * 两者不会撞名。服务端播种器会按「落在扩展域但目录未定义」清理一次，所以用户元素的 id
 * 绝不能占用这些前缀。</p>
 */
export const EXTENSION_ID_PREFIXES = [
  'ext-', 'mc-', 'st-', 'rel-', 'prim-', 'val-', 'unit-', 'dim-', 'std-',
]

/** 该 id 是否落在扩展域命名空间里。 */
export function isExtensionId(id: string): boolean {
  return EXTENSION_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}
