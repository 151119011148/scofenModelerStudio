package com.scofen.model.metamodel;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/** 语义层唯一事实源。不可变：改名产生新对象，所有 Diagram 引用同一个 id。 */
public record ModelElement(
        String id,
        String type,
        String name,
        List<String> stereotypes,
        String ownerId,
        String documentation,
        Map<String, String> taggedValues,
        String xmiId) {

    public ModelElement {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(type, "type");
        stereotypes = stereotypes == null ? List.of() : List.copyOf(stereotypes);
        taggedValues = taggedValues == null ? Map.of() : Map.copyOf(taggedValues);
    }

    public static ModelElement of(String id, String type, String name, String ownerId) {
        return new ModelElement(id, type, name, List.of(), ownerId, "", Map.of(), null);
    }

    public ModelElement withName(String newName) {
        return new ModelElement(id, type, newName, stereotypes, ownerId, documentation, taggedValues, xmiId);
    }

    public ModelElement withDocumentation(String text) {
        return new ModelElement(id, type, name, stereotypes, ownerId, text, taggedValues, xmiId);
    }
}
