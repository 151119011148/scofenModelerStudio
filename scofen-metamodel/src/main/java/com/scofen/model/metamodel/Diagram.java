package com.scofen.model.metamodel;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 图只是视图：只保存对语义元素/关系 id 的引用，不含副本。
 *
 * <p>{@code style} 是图的表示层配置（SysML 图框开关、边框色、标题等），
 * 由 {@code SET_DIAGRAM_STYLE} 命令写入，随快照与 .di.json 侧车往返。
 * 它不属于 UML 元属性，键与取值由 {@link NotationStyle} 统一约束。</p>
 */
public record Diagram(
        String id,
        DiagramKind kind,
        String name,
        String ownerId,
        List<String> elementIds,
        List<String> relationshipIds,
        Map<String, String> style,
        String customTypeId) {

    public Diagram {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(kind, "kind");
        elementIds = elementIds == null ? List.of() : List.copyOf(elementIds);
        relationshipIds = relationshipIds == null ? List.of() : List.copyOf(relationshipIds);
        style = style == null ? Map.of() : Map.copyOf(style);
        customTypeId = customTypeId == null || customTypeId.isBlank() ? null : customTypeId;
    }

    /** 兼容旧调用与旧快照：缺省样式为空表、不是自定义图。 */
    public Diagram(String id, DiagramKind kind, String name, String ownerId,
                   List<String> elementIds, List<String> relationshipIds) {
        this(id, kind, name, ownerId, elementIds, relationshipIds, Map.of(), null);
    }

    /** 兼容带样式但无自定义图类型的调用（既有快照 / 侧车）。 */
    public Diagram(String id, DiagramKind kind, String name, String ownerId,
                   List<String> elementIds, List<String> relationshipIds, Map<String, String> style) {
        this(id, kind, name, ownerId, elementIds, relationshipIds, style, null);
    }

    /** 该图是否为用户自定义图类型（有定义元素引用）。 */
    public boolean custom() {
        return customTypeId != null;
    }

    public static Diagram of(String id, DiagramKind kind, String name, List<String> elementIds) {
        return new Diagram(id, kind, name, null, elementIds, List.of(), Map.of(), null);
    }

    public static Diagram of(String id, DiagramKind kind, String name, String ownerId, List<String> elementIds) {
        return new Diagram(id, kind, name, ownerId, elementIds, List.of(), Map.of(), null);
    }

    /** 自定义图：沿用基底图的布局与校验，同时记住定义元素 id。 */
    public static Diagram of(String id, DiagramKind kind, String name, String ownerId,
                             List<String> elementIds, String customTypeId) {
        return new Diagram(id, kind, name, ownerId, elementIds, List.of(), Map.of(), customTypeId);
    }

    public Diagram withName(String name) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds, style, customTypeId);
    }

    public Diagram withOwnerId(String ownerId) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds, style, customTypeId);
    }

    /** 只改成员引用，保留图框样式与自定义图类型。 */
    public Diagram withRefs(List<String> newElementIds) {
        return new Diagram(id, kind, name, ownerId, newElementIds, relationshipIds, style, customTypeId);
    }

    /** 只改表示层样式，语义成员一律不动。 */
    public Diagram withStyle(Map<String, String> newStyle) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds, newStyle, customTypeId);
    }

    /** 改自定义图类型引用；传 null 退回规范图。 */
    public Diagram withCustomTypeId(String newCustomTypeId) {
        return new Diagram(id, kind, name, ownerId, elementIds, relationshipIds, style, newCustomTypeId);
    }
}
