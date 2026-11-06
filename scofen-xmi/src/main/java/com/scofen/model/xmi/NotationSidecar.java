package com.scofen.model.xmi;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 布局侧车：标准 XMI 不承载图类型、图名与坐标，少了它九图会塌成一个点。
 *
 * <p>因此语义与布局分两个文件：{@code .xmi} 给别的工具看，
 * {@code .di.json} 给我们自己（或任何支持侧车的工具）还原九图。</p>
 *
 * <p>格式刻意做成朴素 JSON，便于人工检查与用任意脚本处理。</p>
 */
public final class NotationSidecar {

    public static final String FORMAT = "scofen.di";
    public static final String VERSION = "1.0";

    /** 一张图：类型、名称、宿主与成员。 */
    public record DiagramEntry(String id, String kind, String name, String ownerId,
                               List<String> elementIds, List<String> relationshipIds) {
        public DiagramEntry {
            elementIds = elementIds == null ? List.of() : List.copyOf(elementIds);
            relationshipIds = relationshipIds == null ? List.of() : List.copyOf(relationshipIds);
        }
    }

    /** 一个记号：某图上某元素的坐标与尺寸。 */
    public record NotationEntry(String id, String diagramId, String elementId,
                                double x, double y, double width, double height,
                                Map<String, String> style) {
        public NotationEntry {
            style = style == null ? Map.of() : Map.copyOf(style);
        }
    }

    public record Sidecar(String format, String version,
                          List<DiagramEntry> diagrams, List<NotationEntry> notations) {
        public Sidecar {
            diagrams = diagrams == null ? List.of() : List.copyOf(diagrams);
            notations = notations == null ? List.of() : List.copyOf(notations);
        }
    }

    /** 从快照的图与记号装配侧车。 */
    public static Sidecar of(List<com.scofen.model.metamodel.Diagram> diagrams,
                              List<com.scofen.model.metamodel.Notation> notations) {
        List<DiagramEntry> diagramEntries = new ArrayList<>();
        for (com.scofen.model.metamodel.Diagram diagram : diagrams) {
            diagramEntries.add(new DiagramEntry(diagram.id(), diagram.kind().code(), diagram.name(),
                    diagram.ownerId(), diagram.elementIds(), diagram.relationshipIds()));
        }
        List<NotationEntry> notationEntries = new ArrayList<>();
        for (com.scofen.model.metamodel.Notation notation : notations) {
            notationEntries.add(new NotationEntry(notation.id(), notation.diagramId(), notation.elementId(),
                    notation.x(), notation.y(), notation.width(), notation.height(), notation.style()));
        }
        return new Sidecar(FORMAT, VERSION, diagramEntries, notationEntries);
    }

    /** 侧车 → 便于序列化的普通 Map（键名用驼峰，JSON 里直接可读）。 */
    public static Map<String, Object> toMap(Sidecar sidecar) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("format", sidecar.format());
        result.put("version", sidecar.version());
        List<Map<String, Object>> diagrams = new ArrayList<>();
        for (DiagramEntry diagram : sidecar.diagrams()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", diagram.id());
            row.put("kind", diagram.kind());
            row.put("name", diagram.name());
            row.put("ownerId", diagram.ownerId());
            row.put("elementIds", diagram.elementIds());
            row.put("relationshipIds", diagram.relationshipIds());
            diagrams.add(row);
        }
        result.put("diagrams", diagrams);
        List<Map<String, Object>> notations = new ArrayList<>();
        for (NotationEntry notation : sidecar.notations()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", notation.id());
            row.put("diagramId", notation.diagramId());
            row.put("elementId", notation.elementId());
            row.put("x", notation.x());
            row.put("y", notation.y());
            row.put("width", notation.width());
            row.put("height", notation.height());
            row.put("style", notation.style());
            notations.add(row);
        }
        result.put("notations", notations);
        return result;
    }
}
