package com.scofen.model.metamodel;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 节点默认尺寸：按「图种 + 元素类型」取值。
 *
 * <p>扩展图（Profile Diagram）对齐华望 M-Design 的图形默认 bounds：
 * 构造型 / 元类（Class 系）100 × 50，剖面 / 包 100 × 80。
 * 其他九种图保持既有的 168 × 84，不做行为变更。</p>
 *
 * <p>尺寸是「首次落图」的默认值，之后以 Notation 上记录的宽高为准；
 * 前端与服务端必须同源，否则拖放落点的居中会偏。</p>
 */
public final class NodeSizeCatalog {

    public record Size(double width, double height) {
    }

    /** 既有九图的全局默认尺寸，与 {@code ValidationEngine.NODE_WIDTH/NODE_HEIGHT} 一致。 */
    public static final Size DEFAULT = new Size(168, 84);

    private static final Size PROFILE_CLASSIFIER = new Size(100, 50);
    /** 标签定义的 «TagDefinition» 关键字比 «Metaclass» 长，100 宽会被省略号截断。 */
    private static final Size PROFILE_TAG = new Size(120, 50);
    private static final Size PROFILE_PACKAGE = new Size(100, 80);

    private NodeSizeCatalog() {
    }

    /** 首次落图时的默认尺寸；未知类型一律回退全局默认。 */
    public static Size of(DiagramKind kind, String elementType) {
        if (kind != DiagramKind.PROFILE) {
            return DEFAULT;
        }
        ElementType type = ElementType.fromAny(elementType).orElse(null);
        if (type == null) {
            return DEFAULT;
        }
        return switch (type) {
            case STEREOTYPE, METACLASS, CLASS, DIAGRAM_TYPE -> PROFILE_CLASSIFIER;
            case TAG_DEFINITION -> PROFILE_TAG;
            case PROFILE, PACKAGE, MODEL, MODEL_LIBRARY -> PROFILE_PACKAGE;
            default -> DEFAULT;
        };
    }

    /**
     * 下发给前端的尺寸表，键为 {@code 图种:元素枚举名}。
     *
     * <p>只下发与默认值不同的条目，前端查不到时自然回退 {@code containment.node}。</p>
     */
    public static Map<String, Map<String, Double>> deviations() {
        Map<String, Map<String, Double>> sizes = new LinkedHashMap<>();
        for (ElementType type : ElementType.values()) {
            Size size = of(DiagramKind.PROFILE, type.name());
            if (size.equals(DEFAULT)) {
                continue;
            }
            sizes.put(DiagramKind.PROFILE.code() + ":" + type.name(),
                    Map.of("width", size.width(), "height", size.height()));
        }
        return sizes;
    }
}
