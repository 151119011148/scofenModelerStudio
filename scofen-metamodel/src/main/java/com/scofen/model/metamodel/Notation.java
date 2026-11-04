package com.scofen.model.metamodel;

import java.util.Map;
import java.util.Objects;

/** 记法（坐标/尺寸/折叠状态）与语义分离，供 .scofen.json 无损往返与 .di.json 侧车使用。 */
public record Notation(
        String id,
        String diagramId,
        String elementId,
        double x,
        double y,
        double width,
        double height,
        Map<String, String> style) {

    public Notation {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(diagramId, "diagramId");
        Objects.requireNonNull(elementId, "elementId");
        style = style == null ? Map.of() : Map.copyOf(style);
    }
}
