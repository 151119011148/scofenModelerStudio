package com.scofen.model.core;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 服务端的模型真本（M0 骨架：内存权威层）。
 * 四对象分离、全局 revision、affectedIds、inverse 均在此产生；
 * 下一步接 MySQL 8.4 + Flyway 时替换本实现，Command 协议不变。
 */
public final class InMemoryModelRepository {

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
            String id = cmd.str("id");
            List<Change> changes = new ArrayList<>();
            List<String> affected = new ArrayList<>();
            Command inverse;

            switch (cmd.type()) {
                case "CREATE_ELEMENT" -> {
                    if (elements.containsKey(id)) {
                        throw new ValidationException("Element already exists: " + id);
                    }
                    ModelElement element = ModelElement.of(id, cmd.str("type"), cmd.str("name"), cmd.str("ownerId"));
                    elements.put(id, element);
                    changes.add(new Change("add", "element", id, null, element));
                    affected.add(id);
                    inverse = Command.of("DELETE_ELEMENT", revision, id + ":inverse", Map.of("id", id));
                }
                case "RENAME_ELEMENT" -> {
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
                    ModelElement before = requireElement(id);
                    ModelElement after = before.withDocumentation(cmd.str("documentation"));
                    elements.put(id, after);
                    changes.add(new Change("update", "element", id, before, after));
                    affected.add(id);
                    inverse = Command.of("UPDATE_DOCUMENTATION", revision, id + ":inverse",
                            Map.of("id", id, "documentation", before.documentation() == null ? "" : before.documentation()));
                }
                case "DELETE_ELEMENT" -> {
                    ModelElement before = requireElement(id);
                    elements.remove(id);
                    for (String diagramId : List.copyOf(diagrams.keySet())) {
                        Diagram diagram = diagrams.get(diagramId);
                        if (diagram.elementIds().contains(id)) {
                            Diagram cleaned = new Diagram(diagram.id(), diagram.kind(), diagram.name(), diagram.ownerId(),
                                    diagram.elementIds().stream().filter(ref -> !ref.equals(id)).toList(),
                                    diagram.relationshipIds());
                            diagrams.put(diagramId, cleaned);
                            affected.add(diagramId);
                            changes.add(new Change("update", "diagram", diagramId, diagram, cleaned));
                        }
                    }
                    changes.add(new Change("remove", "element", id, before, null));
                    affected.add(id);
                    inverse = Command.of("CREATE_ELEMENT", revision, id + ":inverse",
                            Map.of("id", before.id(), "type", before.type(), "name", before.name(),
                                    "ownerId", before.ownerId() == null ? "" : before.ownerId()));
                }
                case "CREATE_RELATIONSHIP" -> {
                    Relationship relationship = Relationship.of(id, cmd.str("type"), cmd.str("sourceId"), cmd.str("targetId"));
                    relationships.put(id, relationship);
                    changes.add(new Change("add", "relationship", id, null, relationship));
                    affected.add(id);
                    affected.add(relationship.sourceId());
                    affected.add(relationship.targetId());
                    inverse = Command.of("DELETE_RELATIONSHIP", revision, id + ":inverse", Map.of("id", id));
                }
                case "DELETE_RELATIONSHIP" -> {
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
                    DiagramKind kind = DiagramKind.fromCode(cmd.str("kind"));
                    Diagram diagram = Diagram.of(id, kind, cmd.str("name"), cmd.strList("elementIds"));
                    diagrams.put(id, diagram);
                    changes.add(new Change("add", "diagram", id, null, diagram));
                    affected.add(id);
                    inverse = Command.of("DELETE_DIAGRAM", revision, id + ":inverse", Map.of("id", id));
                }
                case "DELETE_DIAGRAM" -> {
                    Diagram before = diagrams.remove(id);
                    if (before == null) {
                        throw new ValidationException("Unknown diagram: " + id);
                    }
                    changes.add(new Change("remove", "diagram", id, before, null));
                    affected.add(id);
                    inverse = Command.of("CREATE_DIAGRAM", revision, id + ":inverse",
                            Map.of("id", id, "kind", before.kind().code(), "name", before.name(),
                                    "elementIds", before.elementIds()));
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
                    Diagram after = new Diagram(before.id(), before.kind(), before.name(), before.ownerId(),
                            List.copyOf(refs), before.relationshipIds());
                    diagrams.put(diagramId, after);
                    changes.add(new Change("update", "diagram", diagramId, before, after));
                    affected.add(diagramId);
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
                    Diagram after = new Diagram(before.id(), before.kind(), before.name(), before.ownerId(),
                            before.elementIds().stream().filter(ref -> !ref.equals(elementId)).toList(),
                            before.relationshipIds());
                    diagrams.put(diagramId, after);
                    changes.add(new Change("update", "diagram", diagramId, before, after));
                    affected.add(diagramId);
                    inverse = Command.of("ADD_TO_DIAGRAM", revision, diagramId + ":inverse",
                            Map.of("diagramId", diagramId, "elementId", elementId));
                }
                default -> throw new ValidationException("Unknown command type: " + cmd.type());
            }

            revision++;
            sequence++;
            return new Patch(sequence, revision, affected, changes, inverse, "ok", cmd.clientCmdId());
        }
    }

    private ModelElement requireElement(String id) {
        ModelElement element = elements.get(id);
        if (element == null) {
            throw new ValidationException("Unknown element: " + id);
        }
        return element;
    }
}
