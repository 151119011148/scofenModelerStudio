package com.scofen.model.core;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 服务端的模型真本（M0 骨架：内存权威层）。
 * 四对象分离、全局 revision、affectedIds、inverse 均在此产生；
 * 下一步接 MySQL 8.4 + Flyway 时替换本实现，Command 协议不变。
 */
public final class InMemoryModelRepository {

    public static final double NODE_WIDTH = 168.0;
    public static final double NODE_HEIGHT = 84.0;

    private static final double GRID_X = 196.0;
    private static final double GRID_Y = 128.0;

    private final Object lock = new Object();
    private long revision;
    private long sequence;
    private final Map<String, ModelElement> elements = new LinkedHashMap<>();
    private final Map<String, Relationship> relationships = new LinkedHashMap<>();
    private final Map<String, Diagram> diagrams = new LinkedHashMap<>();
    private final Map<String, Notation> notations = new LinkedHashMap<>();

    public long revision() {
        synchronized (lock) {
            return revision;
        }
    }

    /**
     * 用持久化层回载的快照整体替换内存态（启动恢复或测试注入）。
     * 替换是原子且同步的，不会与正在进行的 apply 交错。
     */
    public void load(ModelSnapshot snapshot) {
        synchronized (lock) {
            this.revision = snapshot.revision();
            this.elements.clear();
            snapshot.elements().forEach(element -> elements.put(element.id(), element));
            this.relationships.clear();
            snapshot.relationships().forEach(relation -> relationships.put(relation.id(), relation));
            this.diagrams.clear();
            snapshot.diagrams().forEach(diagram -> diagrams.put(diagram.id(), diagram));
            this.notations.clear();
            snapshot.notations().forEach(notation -> notations.put(notation.id(), notation));
        }
    }

    public ModelSnapshot snapshot() {
        synchronized (lock) {
            return new ModelSnapshot(revision,
                    new ArrayList<>(elements.values()),
                    new ArrayList<>(relationships.values()),
                    new ArrayList<>(diagrams.values()),
                    new ArrayList<>(notations.values()));
        }
    }

    public Optional<ModelElement> findElement(String id) {
        synchronized (lock) {
            return Optional.ofNullable(elements.get(id));
        }
    }

    public Optional<Diagram> findDiagram(String id) {
        synchronized (lock) {
            return Optional.ofNullable(diagrams.get(id));
        }
    }

    public List<ModelElement> elements() {
        return snapshot().elements();
    }

    public Collection<Relationship> relationships() {
        return snapshot().relationships();
    }

    public boolean elementExists(String id) {
        return findElement(id).isPresent();
    }

    public List<Diagram> diagramsReferencing(String elementId) {
        return snapshot().diagrams().stream().filter(d -> d.elementIds().contains(elementId)).toList();
    }

    public Patch apply(Command cmd) {
        synchronized (lock) {
            List<Change> changes = new ArrayList<>();
            List<String> affected = new ArrayList<>();
            Command inverse;

            switch (cmd.type()) {
                case "CREATE_ELEMENT" -> {
                    String id = cmd.str("id");
                    if (elements.containsKey(id)) {
                        throw new ValidationException("Element already exists: " + id);
                    }
                    ModelElement element = new ModelElement(id, cmd.str("type"), cmd.str("name"),
                            cmd.strList("stereotypes"), blankToNull(cmd.str("ownerId")),
                            orEmpty(cmd.str("documentation")), Map.of(), blankToNull(cmd.str("xmiId")));
                    elements.put(id, element);
                    changes.add(new Change("add", "element", id, null, element));
                    affected.add(id);

                    String diagramId = cmd.str("diagramId");
                    if (hasText(diagramId)) {
                        Diagram before = requireDiagram(diagramId);
                        List<String> refs = new ArrayList<>(before.elementIds());
                        refs.add(id);
                        Diagram after = withRefs(before, refs);
                        diagrams.put(diagramId, after);
                        changes.add(new Change("update", "diagram", diagramId, before, after));
                        affected.add(diagramId);
                        Notation notation = defaultNotation(diagramId, id, refs.size() - 1);
                        notations.put(notation.id(), notation);
                        changes.add(new Change("add", "notation", notation.id(), null, notation));
                        affected.add(notation.id());
                    }
                    inverse = Command.of("DELETE_ELEMENT", revision, id + ":inverse", Map.of("id", id));
                }
                case "RENAME_ELEMENT" -> {
                    String id = cmd.str("id");
                    ModelElement before = requireElement(id);
                    ModelElement after = before.withName(cmd.str("name"));
                    elements.put(id, after);
                    changes.add(new Change("update", "element", id, before, after));
                    affected.add(id);
                    for (Diagram diagram : diagrams.values()) {
                        if (diagram.elementIds().contains(id)) {
                            affected.add(diagram.id());
                        }
                    }
                    inverse = Command.of("RENAME_ELEMENT", revision, id + ":inverse",
                            Map.of("id", id, "name", before.name()));
                }
                case "UPDATE_DOCUMENTATION" -> {
                    String id = cmd.str("id");
                    ModelElement before = requireElement(id);
                    ModelElement after = before.withDocumentation(cmd.str("documentation"));
                    elements.put(id, after);
                    changes.add(new Change("update", "element", id, before, after));
                    affected.add(id);
                    inverse = Command.of("UPDATE_DOCUMENTATION", revision, id + ":inverse",
                            Map.of("id", id, "documentation", orEmpty(before.documentation())));
                }
                case "DELETE_ELEMENT" -> {
                    String rootId = cmd.str("id");
                    requireElement(rootId);
                    Set<String> subtree = collectSubtree(rootId);

                    List<Map<String, Object>> removedElements = new ArrayList<>();
                    List<Map<String, Object>> removedRelationships = new ArrayList<>();
                    List<Map<String, Object>> removedNotations = new ArrayList<>();
                    List<Map<String, Object>> diagramRefs = new ArrayList<>();

                    for (Diagram diagram : diagrams.values()) {
                        if (diagram.elementIds().stream().anyMatch(subtree::contains)) {
                            Map<String, Object> ref = new LinkedHashMap<>();
                            ref.put("diagramId", diagram.id());
                            ref.put("elementIds", List.copyOf(diagram.elementIds()));
                            diagramRefs.add(ref);
                        }
                    }
                    for (String id : subtree) {
                        ModelElement removed = elements.remove(id);
                        if (removed != null) {
                            removedElements.add(elementToMap(removed));
                            changes.add(new Change("remove", "element", id, removed, null));
                            affected.add(id);
                        }
                    }
                    for (String id : List.copyOf(relationships.keySet())) {
                        Relationship relation = relationships.get(id);
                        if (subtree.contains(relation.sourceId()) || subtree.contains(relation.targetId())) {
                            relationships.remove(id);
                            removedRelationships.add(relationshipToMap(relation));
                            changes.add(new Change("remove", "relationship", id, relation, null));
                            affected.add(id);
                        }
                    }
                    for (String id : List.copyOf(notations.keySet())) {
                        Notation notation = notations.get(id);
                        if (subtree.contains(notation.elementId())) {
                            notations.remove(id);
                            removedNotations.add(notationToMap(notation));
                            changes.add(new Change("remove", "notation", id, notation, null));
                            affected.add(id);
                        }
                    }
                    for (String diagramId : List.copyOf(diagrams.keySet())) {
                        Diagram before = diagrams.get(diagramId);
                        if (before.elementIds().stream().noneMatch(subtree::contains)) {
                            continue;
                        }
                        Diagram after = withRefs(before,
                                before.elementIds().stream().filter(ref -> !subtree.contains(ref)).toList());
                        diagrams.put(diagramId, after);
                        changes.add(new Change("update", "diagram", diagramId, before, after));
                        affected.add(diagramId);
                    }
                    inverse = Command.of("RESTORE_SUBTREE", revision, rootId + ":inverse", Map.of(
                            "rootId", rootId,
                            "elements", removedElements,
                            "relationships", removedRelationships,
                            "notations", removedNotations,
                            "diagramRefs", diagramRefs));
                }
                case "RESTORE_SUBTREE" -> {
                    for (Map<String, Object> row : cmd.mapList("elements")) {
                        ModelElement element = new ModelElement(str(row, "id"), str(row, "type"), str(row, "name"),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                orEmpty(str(row, "documentation")), strMap(row, "taggedValues"),
                                blankToNull(str(row, "xmiId")));
                        elements.put(element.id(), element);
                        changes.add(new Change("add", "element", element.id(), null, element));
                        affected.add(element.id());
                    }
                    for (Map<String, Object> row : cmd.mapList("relationships")) {
                        Relationship relation = new Relationship(str(row, "id"), str(row, "type"),
                                str(row, "sourceId"), str(row, "targetId"),
                                blankToNull(str(row, "ownerId")), strMap(row, "taggedValues"));
                        relationships.put(relation.id(), relation);
                        changes.add(new Change("add", "relationship", relation.id(), null, relation));
                        affected.add(relation.id());
                    }
                    for (Map<String, Object> row : cmd.mapList("notations")) {
                        Notation notation = new Notation(str(row, "id"), str(row, "diagramId"),
                                str(row, "elementId"), dbl(row, "x"), dbl(row, "y"),
                                dbl(row, "width", NODE_WIDTH), dbl(row, "height", NODE_HEIGHT),
                                strMap(row, "style"));
                        notations.put(notation.id(), notation);
                        changes.add(new Change("add", "notation", notation.id(), null, notation));
                        affected.add(notation.id());
                    }
                    for (Map<String, Object> row : cmd.mapList("diagramRefs")) {
                        String diagramId = str(row, "diagramId");
                        Diagram before = diagrams.get(diagramId);
                        if (before != null) {
                            Diagram after = withRefs(before, strList(row, "elementIds"));
                            diagrams.put(diagramId, after);
                            changes.add(new Change("update", "diagram", diagramId, before, after));
                            affected.add(diagramId);
                        }
                    }
                    inverse = Command.of("DELETE_ELEMENT", revision, "restore:" + cmd.str("rootId") + ":inverse",
                            Map.of("id", cmd.str("rootId")));
                }
                case "MOVE_NOTATION" -> {
                    String diagramId = cmd.str("diagramId");
                    String elementId = cmd.str("elementId");
                    requireDiagram(diagramId);
                    String notationId = notationId(diagramId, elementId);
                    Notation before = notations.get(notationId);
                    Notation after = new Notation(notationId, diagramId, elementId,
                            cmd.decimal("x"), cmd.decimal("y"),
                            before == null ? NODE_WIDTH : before.width(),
                            before == null ? NODE_HEIGHT : before.height(),
                            before == null ? Map.of() : before.style());
                    notations.put(notationId, after);
                    changes.add(new Change(before == null ? "add" : "update", "notation", notationId, before, after));
                    affected.add(notationId);
                    affected.add(diagramId);
                    affected.add(elementId);
                    inverse = before == null
                            ? Command.of("DELETE_NOTATION", revision, notationId + ":inverse",
                                    Map.of("id", notationId, "diagramId", diagramId))
                            : Command.of("MOVE_NOTATION", revision, notationId + ":inverse",
                                    Map.of("diagramId", diagramId, "elementId", elementId,
                                            "x", before.x(), "y", before.y()));
                }
                case "DELETE_NOTATION" -> {
                    String notationId = cmd.str("id");
                    Notation before = notations.remove(notationId);
                    if (before == null) {
                        throw new ValidationException("Unknown notation: " + notationId);
                    }
                    changes.add(new Change("remove", "notation", notationId, before, null));
                    affected.add(notationId);
                    affected.add(before.diagramId());
                    inverse = Command.of("MOVE_NOTATION", revision, notationId + ":inverse",
                            Map.of("diagramId", before.diagramId(), "elementId", before.elementId(),
                                    "x", before.x(), "y", before.y()));
                }
                case "CREATE_RELATIONSHIP" -> {
                    String id = cmd.str("id");
                    Relationship relationship = Relationship.of(id, cmd.str("type"), cmd.str("sourceId"), cmd.str("targetId"));
                    relationships.put(id, relationship);
                    changes.add(new Change("add", "relationship", id, null, relationship));
                    affected.add(id);
                    affected.add(relationship.sourceId());
                    affected.add(relationship.targetId());
                    inverse = Command.of("DELETE_RELATIONSHIP", revision, id + ":inverse", Map.of("id", id));
                }
                case "DELETE_RELATIONSHIP" -> {
                    String id = cmd.str("id");
                    Relationship before = relationships.remove(id);
                    if (before == null) {
                        throw new ValidationException("Unknown relationship: " + id);
                    }
                    changes.add(new Change("remove", "relationship", id, before, null));
                    affected.add(id);
                    inverse = Command.of("CREATE_RELATIONSHIP", revision, id + ":inverse",
                            Map.of("id", id, "type", before.type(), "sourceId", before.sourceId(), "targetId", before.targetId()));
                }
                case "CREATE_DIAGRAM" -> {
                    String id = cmd.str("id");
                    DiagramKind kind = DiagramKind.fromCode(cmd.str("kind"));
                    Diagram diagram = Diagram.of(id, kind, cmd.str("name"), blankToNull(cmd.str("ownerId")), cmd.strList("elementIds"));
                    diagrams.put(id, diagram);
                    changes.add(new Change("add", "diagram", id, null, diagram));
                    affected.add(id);
                    List<Map<String, Object>> restored = cmd.mapList("notations");
                    if (restored.isEmpty()) {
                        int index = 0;
                        for (String ref : diagram.elementIds()) {
                            Notation notation = defaultNotation(id, ref, index++);
                            notations.put(notation.id(), notation);
                            changes.add(new Change("add", "notation", notation.id(), null, notation));
                            affected.add(notation.id());
                        }
                    } else {
                        for (Map<String, Object> row : restored) {
                            Notation notation = new Notation(str(row, "id"), id, str(row, "elementId"),
                                    dbl(row, "x"), dbl(row, "y"), dbl(row, "width", NODE_WIDTH),
                                    dbl(row, "height", NODE_HEIGHT), strMap(row, "style"));
                            notations.put(notation.id(), notation);
                            changes.add(new Change("add", "notation", notation.id(), null, notation));
                            affected.add(notation.id());
                        }
                    }
                    inverse = Command.of("DELETE_DIAGRAM", revision, id + ":inverse", Map.of("id", id));
                }
                case "RENAME_DIAGRAM" -> {
                    String id = cmd.str("id");
                    Diagram before = requireDiagram(id);
                    Diagram after = before.withName(cmd.str("name"));
                    diagrams.put(id, after);
                    changes.add(new Change("update", "diagram", id, before, after));
                    affected.add(id);
                    inverse = Command.of("RENAME_DIAGRAM", revision, id + ":inverse",
                            Map.of("id", id, "name", before.name()));
                }
                case "DELETE_DIAGRAM" -> {
                    String id = cmd.str("id");
                    Diagram before = diagrams.remove(id);
                    if (before == null) {
                        throw new ValidationException("Unknown diagram: " + id);
                    }
                    changes.add(new Change("remove", "diagram", id, before, null));
                    affected.add(id);
                    List<Map<String, Object>> removed = new ArrayList<>();
                    for (String notationId : List.copyOf(notations.keySet())) {
                        Notation notation = notations.get(notationId);
                        if (id.equals(notation.diagramId())) {
                            notations.remove(notationId);
                            removed.add(notationToMap(notation));
                            changes.add(new Change("remove", "notation", notationId, notation, null));
                            affected.add(notationId);
                        }
                    }
                    inverse = Command.of("CREATE_DIAGRAM", revision, id + ":inverse",
                            Map.of("id", id, "kind", before.kind().code(), "name", before.name(),
                                    "elementIds", before.elementIds(), "notations", removed));
                }
                case "ADD_TO_DIAGRAM" -> {
                    String diagramId = cmd.str("diagramId");
                    String elementId = cmd.str("elementId");
                    Diagram before = diagrams.get(diagramId);
                    if (before == null) {
                        throw new ValidationException("Unknown diagram: " + diagramId);
                    }
                    List<String> refs = new ArrayList<>(before.elementIds());
                    if (!refs.contains(elementId)) {
                        refs.add(elementId);
                    }
                    Diagram after = withRefs(before, List.copyOf(refs));
                    diagrams.put(diagramId, after);
                    changes.add(new Change("update", "diagram", diagramId, before, after));
                    affected.add(diagramId);
                    String notationId = notationId(diagramId, elementId);
                    if (!notations.containsKey(notationId)) {
                        Notation notation = defaultNotation(diagramId, elementId, refs.size() - 1);
                        notations.put(notationId, notation);
                        changes.add(new Change("add", "notation", notationId, null, notation));
                        affected.add(notationId);
                    }
                    inverse = Command.of("REMOVE_FROM_DIAGRAM", revision, diagramId + ":inverse",
                            Map.of("diagramId", diagramId, "elementId", elementId));
                }
                case "REMOVE_FROM_DIAGRAM" -> {
                    String diagramId = cmd.str("diagramId");
                    String elementId = cmd.str("elementId");
                    Diagram before = diagrams.get(diagramId);
                    if (before == null) {
                        throw new ValidationException("Unknown diagram: " + diagramId);
                    }
                    Diagram after = withRefs(before,
                            before.elementIds().stream().filter(ref -> !ref.equals(elementId)).toList());
                    diagrams.put(diagramId, after);
                    changes.add(new Change("update", "diagram", diagramId, before, after));
                    affected.add(diagramId);
                    String notationId = notationId(diagramId, elementId);
                    Notation removed = notations.remove(notationId);
                    if (removed != null) {
                        changes.add(new Change("remove", "notation", notationId, removed, null));
                        affected.add(notationId);
                    }
                    inverse = Command.of("ADD_TO_DIAGRAM", revision, diagramId + ":inverse",
                            Map.of("diagramId", diagramId, "elementId", elementId));
                }
                default -> throw new ValidationException("Unknown command type: " + cmd.type());
            }

            revision++;
            sequence++;
            return new Patch(sequence, revision, List.copyOf(affected), List.copyOf(changes),
                    inverse, "ok", cmd.clientCmdId());
        }
    }

    private ModelElement requireElement(String id) {
        ModelElement element = elements.get(id);
        if (element == null) {
            throw new ValidationException("Unknown element: " + id);
        }
        return element;
    }

    private Diagram requireDiagram(String id) {
        Diagram diagram = diagrams.get(id);
        if (diagram == null) {
            throw new ValidationException("Unknown diagram: " + id);
        }
        return diagram;
    }

    /** 沿 ownerId 收集整棵子树，删除时保证不留下孤儿元素。 */
    private Set<String> collectSubtree(String rootId) {
        Set<String> collected = new LinkedHashSet<>();
        Deque<String> queue = new ArrayDeque<>();
        queue.add(rootId);
        while (!queue.isEmpty()) {
            String current = queue.removeFirst();
            if (!collected.add(current)) {
                continue;
            }
            for (ModelElement element : elements.values()) {
                if (current.equals(element.ownerId())) {
                    queue.addLast(element.id());
                }
            }
        }
        return collected;
    }

    private static Diagram withRefs(Diagram diagram, List<String> refs) {
        return new Diagram(diagram.id(), diagram.kind(), diagram.name(), diagram.ownerId(),
                refs, diagram.relationshipIds());
    }

    private static String notationId(String diagramId, String elementId) {
        return "n-" + diagramId + "-" + elementId;
    }

    private static Notation defaultNotation(String diagramId, String elementId, int index) {
        return new Notation(notationId(diagramId, elementId), diagramId, elementId,
                36 + (index % 3) * GRID_X, 36 + (index / 3) * GRID_Y,
                NODE_WIDTH, NODE_HEIGHT, Map.of());
    }

    private static Map<String, Object> elementToMap(ModelElement element) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", element.id());
        row.put("type", element.type());
        row.put("name", element.name());
        row.put("stereotypes", element.stereotypes());
        row.put("ownerId", orEmpty(element.ownerId()));
        row.put("documentation", orEmpty(element.documentation()));
        row.put("taggedValues", element.taggedValues());
        row.put("xmiId", orEmpty(element.xmiId()));
        return row;
    }

    private static Map<String, Object> relationshipToMap(Relationship relation) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", relation.id());
        row.put("type", relation.type());
        row.put("sourceId", relation.sourceId());
        row.put("targetId", relation.targetId());
        row.put("ownerId", orEmpty(relation.ownerId()));
        row.put("taggedValues", relation.taggedValues());
        return row;
    }

    private static Map<String, Object> notationToMap(Notation notation) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", notation.id());
        row.put("diagramId", notation.diagramId());
        row.put("elementId", notation.elementId());
        row.put("x", notation.x());
        row.put("y", notation.y());
        row.put("width", notation.width());
        row.put("height", notation.height());
        row.put("style", notation.style());
        return row;
    }

    private static String str(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static List<String> strList(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().map(String::valueOf).toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> strMap(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (!(value instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
        }
        return Map.copyOf(result);
    }

    private static double dbl(Map<String, Object> row, String key) {
        return dbl(row, key, 0.0);
    }

    private static double dbl(Map<String, Object> row, String key, double fallback) {
        Object value = row.get(key);
        return value instanceof Number number ? number.doubleValue() : fallback;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String blankToNull(String value) {
        return hasText(value) ? value : null;
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }
}
