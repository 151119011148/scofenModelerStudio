package com.scofen.model.metamodel;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 记法样式的公共字典：节点（{@link Notation#style()}）、
 * 关系连线（关系 properties 里 {@code style:<diagramId>}）与图框（{@link Diagram#style()}）
 * 三处共用同一套键和取值规则。
 *
 * <p>样式属于表示层，不是 UML 元属性，因此不进 {@code PropertyCatalog}；
 * 但仍然必须服务端权威：所有写入命令（{@code SET_NOTATION_STYLE} /
 * {@code SET_DIAGRAM_STYLE} / {@code UPDATE_PROPERTY} 的 style 例外）在落库前
 * 一律过 {@link #validate(Map)}，避免把任意字符串 / 脚本 / 越界数值写进快照，
 * 再被前端直接塞进 SVG 属性。</p>
 *
 * <p>值统一存字符串：{@code Map<String,String>} 可直接进快照、进 XMI 侧车，
 * 也免去 Jackson 反序列化后数字变 Integer / Double 的类型抖动。</p>
 */
public final class NotationStyle {

    /** 关系 / 元素 properties 里按图保存的连线样式键前缀。 */
    public static final String PROPERTY_PREFIX = "style:";

    /** 图框开关：{@code on} / {@code off}，缺省视为 on。 */
    public static final String FRAME = "frame";
    /** 图框标题自定义文本；留空走规范默认「图种 [宿主 [图名]]」。 */
    public static final String FRAME_TITLE = "frameTitle";
    public static final int FRAME_TITLE_MAX = 160;

    /** 颜色键：允许 #RGB / #RRGGBB / #RRGGBBAA / none / transparent。 */
    public static final Set<String> COLOR_KEYS = Set.of(
            "fontColor", "fill", "stroke", "lineColor",
            "frameBorder", "frameKindColor", "frameText");

    /** 数值键与合法区间（含端点）。 */
    public static final Map<String, double[]> NUMBER_KEYS = Map.of(
            "fontSize", new double[]{8, 48},
            "labelFontSize", new double[]{8, 24},
            "fillOpacity", new double[]{0, 1},
            "strokeWidth", new double[]{0.5, 8},
            "lineWidth", new double[]{0.5, 8},
            "frameFontSize", new double[]{8, 24},
            "frameBorderWidth", new double[]{0.5, 6});

    /** 枚举键与允许值。 */
    public static final Map<String, Set<String>> ENUM_KEYS = Map.of(
            "fontWeight", Set.of("normal", "bold"),
            "textAlign", Set.of("left", "center", "right"),
            "strokeDash", Set.of("solid", "dashed", "dotted"),
            "lineDash", Set.of("solid", "dashed", "dotted"),
            "shapeVariant", Set.of("layer", "container", "rectangle", "rounded", "database"),
            "frame", Set.of("on", "off"));

    private static final Pattern COLOR = Pattern.compile("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");
    private static final Set<String> COLOR_LITERALS = Set.of("none", "transparent");

    private static final Set<String> ALL_KEYS;

    static {
        Set<String> keys = new LinkedHashSet<>();
        keys.addAll(COLOR_KEYS);
        keys.addAll(NUMBER_KEYS.keySet());
        keys.addAll(ENUM_KEYS.keySet());
        keys.add(FRAME_TITLE);
        ALL_KEYS = Set.copyOf(keys);
    }

    private NotationStyle() {
    }

    /** 服务端下发给样式面板的键清单（顺序稳定）。 */
    public static List<String> keys() {
        return List.copyOf(new ArrayList<>(ALL_KEYS));
    }

    /**
     * 把外部 payload 归一成样式补丁：{@code null} 或空串表示删除该键，其余转字符串。
     * 不在这里做合法性判断，合法性由 {@link #validate(Map)} 统一负责。
     */
    public static Map<String, String> normalize(Map<?, ?> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Object value = entry.getValue();
            result.put(key, value == null ? "" : String.valueOf(value));
        }
        return result;
    }

    /**
     * 合并样式：{@code replace=true} 整包替换（撤销 / 重置用），否则增量覆盖；
     * 补丁里值为空串的键从结果里删掉。
     */
    public static Map<String, String> merge(Map<String, String> before, Map<String, String> patch, boolean replace) {
        Map<String, String> result = replace ? new LinkedHashMap<>() : new LinkedHashMap<>(before);
        for (Map.Entry<String, String> entry : patch.entrySet()) {
            if (entry.getValue() == null || entry.getValue().isEmpty()) {
                result.remove(entry.getKey());
            } else {
                result.put(entry.getKey(), entry.getValue());
            }
        }
        return Map.copyOf(result);
    }

    /** 校验整包样式；不合法抛 {@link IllegalArgumentException}，由调用方转成校验失败。 */
    public static void validate(Map<String, String> style) {
        if (style == null || style.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : style.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue();
            if (!ALL_KEYS.contains(key)) {
                throw new IllegalArgumentException("未知样式键: " + key);
            }
            if (value == null || value.isEmpty()) {
                throw new IllegalArgumentException("样式值不能为空（删除请用整包替换）: " + key);
            }
            if (COLOR_KEYS.contains(key)) {
                if (!COLOR.matcher(value).matches() && !COLOR_LITERALS.contains(value)) {
                    throw new IllegalArgumentException("颜色必须是 #RGB / #RRGGBB / none: " + key + "=" + value);
                }
                continue;
            }
            double[] range = NUMBER_KEYS.get(key);
            if (range != null) {
                double number;
                try {
                    number = Double.parseDouble(value);
                } catch (NumberFormatException ex) {
                    throw new IllegalArgumentException("样式值必须是数字: " + key + "=" + value);
                }
                if (!Double.isFinite(number) || number < range[0] || number > range[1]) {
                    throw new IllegalArgumentException("样式值超出范围 " + range[0] + ".." + range[1] + ": " + key);
                }
                continue;
            }
            Set<String> allowed = ENUM_KEYS.get(key);
            if (allowed != null && !allowed.contains(value)) {
                throw new IllegalArgumentException("样式值不在允许集合内: " + key + "=" + value);
            }
            if (FRAME_TITLE.equals(key)
                    && (value.length() > FRAME_TITLE_MAX || value.chars().anyMatch(ch -> Character.isISOControl(ch)))) {
                throw new IllegalArgumentException("图框标题过长或含控制字符");
            }
        }
    }

    /** 判断一个属性键是否属于「按图保存的连线样式」（与 route: 同属表示层例外）。 */
    public static boolean isStyleProperty(String key) {
        return key != null && key.startsWith(PROPERTY_PREFIX);
    }

    /** 从任意对象还原样式包：{@code UPDATE_PROPERTY} 的值可能是反序列化后的 Map。 */
    @SuppressWarnings("unchecked")
    public static Map<String, String> fromPropertyValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return normalize((Map<String, Object>) map);
        }
        return Map.of();
    }
}
