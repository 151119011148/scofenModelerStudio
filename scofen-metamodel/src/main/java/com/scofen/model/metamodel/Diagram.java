package com.scofen.model.metamodel;

import java.util.List;
import java.util.Objects;

/** 图只是视图：只保存对语义元素/关系 id 的引用，不含副本。 */
public record Diagram(
        String id,
        DiagramKind kind,
        String name,
        String ownerId,
        List<String> elementIds,
        List<String> relationshipIds) {

    public Diagram {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(kind, "kind");
        elementIds = elementIds == null ? List.of() : List.copyOf(elementIds);
        relationshipIds = relationshipIds == null ? List.of() : List.copyOf(relationshipIds);
    }

    public static Diagram of(String id, DiagramKind kind, String name, List<String> elementIds) {
        return new Diagram(id, kind, name, null, elementIds, List.of());
    }

    public static Diagram of(String id, DiagramKind kind, String name, String ownerId, List<String> elementIds) {
        return new Diagram(id, kind, name, ownerId, elementIds, List.of());
    }

    public Diagram withName(String name) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds);
    }

    public Diagram withOwnerId(String ownerId) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds);
    }
}
