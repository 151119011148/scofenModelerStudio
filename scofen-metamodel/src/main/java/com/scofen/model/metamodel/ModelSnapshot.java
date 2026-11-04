package com.scofen.model.metamodel;

import java.util.List;

/** 一次 revision 下四对象的完整投影；浏览器只持有它，永不持有真本。 */
public record ModelSnapshot(
        long revision,
        List<ModelElement> elements,
        List<Relationship> relationships,
        List<Diagram> diagrams,
        List<Notation> notations) {

    public ModelSnapshot {
        elements = elements == null ? List.of() : List.copyOf(elements);
        relationships = relationships == null ? List.of() : List.copyOf(relationships);
        diagrams = diagrams == null ? List.of() : List.copyOf(diagrams);
        notations = notations == null ? List.of() : List.copyOf(notations);
    }
}
