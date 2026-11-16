package com.scofen.model.metamodel;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 用户定制（User Customization）字典：自定义图类型与构造型标签定义的属性白名单。
 *
 * <p>参照 MagicDraw / M-Design 的 Custom Diagram 与 Profile 定制能力。本产品把定制物化为
 * 模型里的一等元素，而不是前端 localStorage：</p>
 * <ul>
 *   <li>{@link ElementType#DIAGRAM_TYPE} —— 自定义图类型定义，挂在用户 Profile / 包下；
 *       {@link Diagram#customTypeId()} 指过来，图沿用某个规范图作为布局基底。</li>
 *   <li>{@link ElementType#TAG_DEFINITION} —— 构造型下的标签定义，把
 *       {@code taggedValues} 从自由键值表升级为带类型 / 默认值 / 枚举选项的表单。</li>
 * </ul>
 *
 * <p>属性键统一走 {@code custom:} 前缀，与 {@code route:} / {@code style:} 一样是
 * ValidationEngine 的表示层例外：不进 {@link PropertyCatalog} 的规范元属性清单，
 * 但值仍然逐项校验——这些值最终会决定工具箱清单与 SVG 图框，不能让任意字符串落库。</p>
 */
public final class Customization {

    public static final String PREFIX = "custom:";

    /* ── DiagramType 属性键 ── */
    /** 布局与校验基底：DiagramKind.code()。 */
    public static final String DIAGRAM_BASE_KIND = PREFIX + "baseKind";
    /** 允许的元素类型名（ElementType.name()），JSON 字符串数组。 */
    public static final String DIAGRAM_ALLOWED_TYPES = PREFIX + "allowedTypes";
    /** 允许的关系类型 code（RelationshipType.code()），JSON 字符串数组。 */
    public static final String DIAGRAM_ALLOWED_RELATIONSHIPS = PREFIX + "allowedRelationships";
    /** 自定义图框标题模板；支持 {图种} / {宿主} / {图名} 占位符。 */
    public static final String DIAGRAM_FRAME_TITLE = PREFIX + "frameTitle";
    /** 英文显示名。 */
    public static final String DIAGRAM_LABEL_EN = PREFIX + "labelEn";

    /* ── TagDefinition 属性键 ── */
    /** 标签值类型：STRING / BOOLEAN / INTEGER / REAL / ENUM。 */
    public static final String TAG_TYPE = PREFIX + "tagType";
    /** ENUM 的选项列表。 */
    public static final String TAG_OPTIONS = PREFIX + "options";
    /** 默认值。 */
    public static final String TAG_DEFAULT = PREFIX + "defaultValue";
    /** 是否必填：true / false。 */
    public static final String TAG_REQUIRED = PREFIX + "required";

    /** 自定义图框标题模板的最大长度，与 {@link NotationStyle#FRAME_TITLE_MAX} 对齐。 */
    public static final int MAX_TITLE = NotationStyle.FRAME_TITLE_MAX;

    private static final Set<String> TAG_TYPES = Set.of("STRING", "BOOLEAN", "INTEGER", "REAL", "ENUM");
    private static final Set<String> BOOLEANS = Set.of("true", "false");

    private static final Map<String, String> KEY_LABELS = new LinkedHashMap<>();

    static {
        KEY_LABELS.put(DIAGRAM_BASE_KIND, "布局基底图");
        KEY_LABELS.put(DIAGRAM_ALLOWED_TYPES, "允许的元素类型");
        KEY_LABELS.put(DIAGRAM_ALLOWED_RELATIONSHIPS, "允许的关系类型");
        KEY_LABELS.put(DIAGRAM_FRAME_TITLE, "图框标题模板");
        KEY_LABELS.put(DIAGRAM_LABEL_EN, "英文名称");
        KEY_LABELS.put(TAG_TYPE, "标签类型");
        KEY_LABELS.put(TAG_OPTIONS, "枚举选项");
        KEY_LABELS.put(TAG_DEFAULT, "默认值");
        KEY_LABELS.put(TAG_REQUIRED, "必填");
    }

    /** 该键是否属于定制属性域。 */
    public static boolean isCustomKey(String key) {
        return key != null && key.startsWith(PREFIX);
    }

    /** 下发给前端的字典：键 → 中文标签，前端据此渲染定制表单，不硬编码键名。 */
    public static Map<String, String> keyLabels() {
        return Map.copyOf(KEY_LABELS);
    }

    /** 标签定义允许的类型枚举，下发前端做下拉。 */
    public static List<String> tagTypes() {
        return List.copyOf(TAG_TYPES);
    }

    /**
     * 校验一条定制属性写入。返回规范化后的值（列表保持 List&lt;String&gt;），
     * 非法值抛 {@link IllegalArgumentException} 由 ValidationEngine 转成 400。
     */
    public static Object validate(String key, Object value, boolean remove) {
        if (!isCustomKey(key) || !KEY_LABELS.containsKey(key)) {
            throw new IllegalArgumentException("未知的定制属性: " + key);
        }
        if (remove || value == null) {
            return null;
        }
        if (key.equals(TAG_REQUIRED)) {
            String text = String.valueOf(value);
            if (!BOOLEANS.contains(text)) {
                throw new IllegalArgumentException("必填标记只能是 true / false");
            }
            return text;
        }
        if (key.equals(TAG_TYPE)) {
            String text = String.valueOf(value);
            if (!TAG_TYPES.contains(text)) {
                throw new IllegalArgumentException("未知标签类型: " + text);
            }
            return text;
        }
        if (key.equals(DIAGRAM_BASE_KIND)) {
            String text = String.valueOf(value);
            try {
                DiagramKind.fromCode(text);
            } catch (RuntimeException ex) {
                throw new IllegalArgumentException("未知布局基底图: " + text);
            }
            return text;
        }
        if (key.equals(DIAGRAM_FRAME_TITLE) || key.equals(DIAGRAM_LABEL_EN) || key.equals(TAG_DEFAULT)) {
            String text = String.valueOf(value);
            if (text.length() > MAX_TITLE) {
                throw new IllegalArgumentException("文本超过 " + MAX_TITLE + " 字上限");
            }
            return text;
        }
        // 三个列表键：允许元素 / 允许关系 / 枚举选项。
        List<?> raw = value instanceof List<?> list ? list : List.of(String.valueOf(value));
        Set<String> seen = new LinkedHashSet<>();
        List<String> result = new ArrayList<>();
        for (Object item : raw) {
            String text = String.valueOf(item).trim();
            if (text.isEmpty() || !seen.add(text)) {
                continue;
            }
            if (key.equals(DIAGRAM_ALLOWED_TYPES)) {
                if (ElementType.fromAny(text).isEmpty()) {
                    throw new IllegalArgumentException("未知元素类型: " + text);
                }
            } else if (key.equals(DIAGRAM_ALLOWED_RELATIONSHIPS)
                    && RelationshipType.fromAny(text).isEmpty()) {
                throw new IllegalArgumentException("未知关系类型: " + text);
            }
            result.add(text);
        }
        if ((key.equals(DIAGRAM_ALLOWED_TYPES) || key.equals(DIAGRAM_ALLOWED_RELATIONSHIPS)
                || key.equals(TAG_OPTIONS)) && result.isEmpty()) {
            throw new IllegalArgumentException("列表不能为空");
        }
        return List.copyOf(result);
    }

    /** 从属性包里读字符串列表（兼容 JSON 字符串与已还原的 List）。 */
    public static List<String> stringList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        if (value == null) {
            return List.of();
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) {
            return List.of();
        }
        // 形如 ["A","B"] 的 JSON 数组在 side car 里偶发以字符串形态出现。
        if (text.startsWith("[") && text.endsWith("]")) {
            List<String> result = new ArrayList<>();
            for (String part : text.substring(1, text.length() - 1).split(",")) {
                String item = part.trim().replace("\"", "");
                if (!item.isEmpty()) {
                    result.add(item);
                }
            }
            return List.copyOf(result);
        }
        return List.of(text);
    }

    private Customization() {
    }
}
