package com.scofen.model.core;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
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

    /** 关系与元素共用同一命名空间外的 id 空间，属性写入需要按 id 先查元素再查关系。 */
    public Optional<Relationship> findRelationship(String id) {
        synchronized (lock) {
            return Optional.ofNullable(relationships.get(id));
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
                            orEmpty(cmd.str("documentation")), Map.of(), blankToNull(cmd.str("xmiId")),
                            objectMap(cmd.payload(), "properties"));                    elements.put(id, element);
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
                        // 拖放落位：命令自带坐标时由服务端一次性写入 Notation，
                        // 避免「CREATE_ELEMENT + MOVE_NOTATION」两条命令引发的 baseRevision 竞态。
                        Notation notation = hasPosition(cmd)
                                ? placedNotation(diagramId, id, cmd.decimal("x"), cmd.decimal("y"))
                                : defaultNotation(diagramId, id, refs.size() - 1);
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
                case "UPDATE_PROPERTY" -> {
                    String id = cmd.str("id");
                    String key = cmd.str("key");
                    boolean remove = Boolean.TRUE.equals(cmd.payload().get("remove"));
                    Object value = remove ? null : cmd.payload().get("value");

                    // 关系与元素同为模型对象：先按元素 id 找，找不到再按关系 id 找。
                    Relationship relationBefore = relationships.get(id);
                    if (relationBefore != null) {
                        Object oldValue = relationBefore.property(key);
                        Relationship relationAfter = relationBefore.withProperty(key, value);
                        relationships.put(id, relationAfter);
                        changes.add(new Change("update", "relationship", id, relationBefore, relationAfter));
                        affected.add(id);
                        affected.add(relationBefore.sourceId());
                        affected.add(relationBefore.targetId());
                        Map<String, Object> inversePayload = new LinkedHashMap<>();
                        inversePayload.put("id", id);
                        inversePayload.put("key", key);
                        if (oldValue == null) {
                            inversePayload.put("remove", Boolean.TRUE);
                        } else {
                            inversePayload.put("value", oldValue);
                        }
                        inverse = Command.of("UPDATE_PROPERTY", revision, id + ":" + key + ":inverse",
                                inversePayload);
                    } else {
                        ModelElement before = requireElement(id);
                        Object oldValue = before.property(key);
                        ModelElement after = before.withProperty(key, value);
                        elements.put(id, after);
                        changes.add(new Change("update", "element", id, before, after));
                        affected.add(id);
                        if ("name".equals(key)) {
                            for (Diagram diagram : diagrams.values()) {
                                if (diagram.elementIds().contains(id)) {
                                    affected.add(diagram.id());
                                }
                            }
                        }
                        Map<String, Object> inversePayload = new LinkedHashMap<>();
                        inversePayload.put("id", id);
                        inversePayload.put("key", key);
                        if (oldValue == null) {
                            inversePayload.put("remove", Boolean.TRUE);
                        } else {
                            inversePayload.put("value", oldValue);
                        }
                        inverse = Command.of("UPDATE_PROPERTY", revision, id + ":" + key + ":inverse",
                                inversePayload);
                    }
                }
                case "DELETE_ELEMENT" -> {
                    String rootId = cmd.str("id");
                    requireElement(rootId);
                    DeletedSubtree removed = removeSubtree(collectSubtree(rootId), changes, affected);

                    inverse = Command.of("RESTORE_SUBTREE", revision, rootId + ":inverse", Map.of(
                            "rootId", rootId,
                            "elements", removed.elements(),
                            "relationships", removed.relationships(),
                            "notations", removed.notations(),
                            "diagramRefs", removed.diagramRefs()));
                }
                case "CREATE_ELEMENTS" -> {
                    // 批量建元素：通用扩展包等系统内容用它一次落库，
                    // 只推进一次 revision、只广播一个 Patch。
                    List<Map<String, Object>> rows = cmd.mapList("elements");
                    List<String> created = new ArrayList<>();
                    for (Map<String, Object> row : rows) {
                        String id = str(row, "id");
                        if (elements.containsKey(id)) {
                            throw new ValidationException("Element already exists: " + id);
                        }
                        ModelElement element = new ModelElement(id, str(row, "type"), str(row, "name"),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                orEmpty(str(row, "documentation")), strMap(row, "taggedValues"),
                                blankToNull(str(row, "xmiId")), objectMap(row, "properties"));
                        elements.put(id, element);
                        changes.add(new Change("add", "element", id, null, element));
                        affected.add(id);
                        created.add(id);
                    }
                    inverse = Command.of("DELETE_ELEMENTS", revision, "create-elements:inverse",
                            Map.of("ids", List.copyOf(created)));
                }
                case "DELETE_ELEMENTS" -> {
                    List<String> ids = cmd.strList("ids");
                    if (ids.isEmpty()) {
                        throw new ValidationException("DELETE_ELEMENTS requires at least one id");
                    }
                    Set<String> subtree = new LinkedHashSet<>();
                    for (String id : ids) {
                        requireElement(id);
                        subtree.addAll(collectSubtree(id));
                    }
                    DeletedSubtree removed = removeSubtree(subtree, changes, affected);

                    inverse = Command.of("RESTORE_SUBTREE", revision, "delete-elements:inverse", Map.of(
                            "rootId", ids.get(0),
                            "elements", removed.elements(),
                            "relationships", removed.relationships(),
                            "notations", removed.notations(),
                            "diagramRefs", removed.diagramRefs()));
                }
                case "IMPORT_MODEL" -> {
                    // 整包替换：把导入的模型整体写进项目，只推进一次 revision、
                    // 只广播一个 Patch——逐条 CREATE_ELEMENT 会把 revision 顶高、WS 打爆。
                    //
                    // 「保留扩展包」是这里唯一的例外：通用扩展包是每个项目自带的
                    // SysML / UML 元类清单，换进来反而会让它与本项目的元模型版本脱节。
                    Set<String> keepIds = com.scofen.model.metamodel.ExtensionLibrary
                            .subtreeIds(new ArrayList<>(elements.values()));

                    // 被替换掉的内容留档，供逆命令还原。
                    List<Map<String, Object>> previousElements = new ArrayList<>();
                    List<Map<String, Object>> previousRelationships = new ArrayList<>();
                    List<Map<String, Object>> previousDiagrams = new ArrayList<>();
                    List<Map<String, Object>> previousNotations = new ArrayList<>();
                    for (ModelElement element : new ArrayList<>(elements.values())) {
                        if (keepIds.contains(element.id())) {
                            continue;
                        }
                        elements.remove(element.id());
                        previousElements.add(elementToMap(element));
                        changes.add(new Change("remove", "element", element.id(), element, null));
                        affected.add(element.id());
                    }
                    for (Relationship relation : new ArrayList<>(relationships.values())) {
                        relationships.remove(relation.id());
                        previousRelationships.add(relationshipToMap(relation));
                        changes.add(new Change("remove", "relationship", relation.id(), relation, null));
                        affected.add(relation.id());
                    }
                    for (Diagram diagram : new ArrayList<>(diagrams.values())) {
                        diagrams.remove(diagram.id());
                        previousDiagrams.add(diagramToMap(diagram));
                        changes.add(new Change("remove", "diagram", diagram.id(), diagram, null));
                        affected.add(diagram.id());
                    }
                    for (Notation notation : new ArrayList<>(notations.values())) {
                        notations.remove(notation.id());
                        previousNotations.add(notationToMap(notation));
                        changes.add(new Change("remove", "notation", notation.id(), notation, null));
                        affected.add(notation.id());
                    }

                    for (Map<String, Object> row : cmd.mapList("elements")) {
                        String id = str(row, "id");
                        ModelElement element = new ModelElement(id, str(row, "type"), str(row, "name"),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                orEmpty(str(row, "documentation")), strMap(row, "taggedValues"),
                                blankToNull(str(row, "xmiId")), objectMap(row, "properties"));
                        elements.put(id, element);
                        changes.add(new Change("add", "element", id, null, element));
                        affected.add(id);
                    }
                    for (Map<String, Object> row : cmd.mapList("relationships")) {
                        String id = str(row, "id");
                        Relationship relation = new Relationship(id, str(row, "type"),
                                str(row, "sourceId"), str(row, "targetId"),
                                orEmpty(str(row, "name")), orEmpty(str(row, "documentation")),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                strMap(row, "taggedValues"), objectMap(row, "properties"));
                        relationships.put(id, relation);
                        changes.add(new Change("add", "relationship", id, null, relation));
                        affected.add(id);
                        affected.add(relation.sourceId());
                        affected.add(relation.targetId());
                    }
                    for (Map<String, Object> row : cmd.mapList("diagrams")) {
                        String id = str(row, "id");
                        Diagram diagram = new Diagram(id, DiagramKind.fromCode(str(row, "kind")),
                                str(row, "name"), blankToNull(str(row, "ownerId")),
                                strList(row, "elementIds"), strList(row, "relationshipIds"));
                        diagrams.put(id, diagram);
                        changes.add(new Change("add", "diagram", id, null, diagram));
                        affected.add(id);
                    }
                    for (Map<String, Object> row : cmd.mapList("notations")) {
                        String id = str(row, "id");
                        Notation notation = new Notation(id, str(row, "diagramId"), str(row, "elementId"),
                                dbl(row, "x"), dbl(row, "y"),
                                dbl(row, "width", NODE_WIDTH), dbl(row, "height", NODE_HEIGHT),
                                strMap(row, "style"));
                        notations.put(id, notation);
                        changes.add(new Change("add", "notation", id, null, notation));
                        affected.add(id);
                    }
                    // 逆命令：把替换掉的内容原样写回去。
                    inverse = Command.of("RESTORE_IMPORTED", revision, "import-model:inverse", Map.of(
                            "elements", List.copyOf(previousElements),
                            "relationships", List.copyOf(previousRelationships),
                            "diagrams", List.copyOf(previousDiagrams),
                            "notations", List.copyOf(previousNotations)));
                }
                case "RESTORE_IMPORTED" -> {
                    // 撤销导入：清掉导入进来的内容，把替换掉的旧内容写回。
                    // 扩展包不在其中——它自始至终没有被替换过。
                    // keepIds 必须一次算完：循环里重算会因为元素被逐步移除而缩水，
                    // 结果是扩展包的子元素被误删。
                    Set<String> keepIds = ExtensionLibrary.subtreeIds(new ArrayList<>(elements.values()));
                    for (ModelElement element : new ArrayList<>(elements.values())) {
                        if (keepIds.contains(element.id())) {
                            continue;
                        }
                        elements.remove(element.id());
                        changes.add(new Change("remove", "element", element.id(), element, null));
                        affected.add(element.id());
                    }
                    for (Relationship relation : new ArrayList<>(relationships.values())) {
                        relationships.remove(relation.id());
                        changes.add(new Change("remove", "relationship", relation.id(), relation, null));
                        affected.add(relation.id());
                    }
                    for (Diagram diagram : new ArrayList<>(diagrams.values())) {
                        diagrams.remove(diagram.id());
                        changes.add(new Change("remove", "diagram", diagram.id(), diagram, null));
                        affected.add(diagram.id());
                    }
                    for (Notation notation : new ArrayList<>(notations.values())) {
                        notations.remove(notation.id());
                        changes.add(new Change("remove", "notation", notation.id(), notation, null));
                        affected.add(notation.id());
                    }
                    List<Map<String, Object>> restoredElements = new ArrayList<>();
                    List<Map<String, Object>> restoredRelationships = new ArrayList<>();
                    List<Map<String, Object>> restoredDiagrams = new ArrayList<>();
                    List<Map<String, Object>> restoredNotations = new ArrayList<>();
                    for (Map<String, Object> row : cmd.mapList("elements")) {
                        ModelElement element = new ModelElement(str(row, "id"), str(row, "type"), str(row, "name"),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                orEmpty(str(row, "documentation")), strMap(row, "taggedValues"),
                                blankToNull(str(row, "xmiId")), objectMap(row, "properties"));
                        elements.put(element.id(), element);
                        changes.add(new Change("add", "element", element.id(), null, element));
                        affected.add(element.id());
                        restoredElements.add(elementToMap(element));
                    }
                    for (Map<String, Object> row : cmd.mapList("relationships")) {
                        Relationship relation = new Relationship(str(row, "id"), str(row, "type"),
                                str(row, "sourceId"), str(row, "targetId"),
                                orEmpty(str(row, "name")), orEmpty(str(row, "documentation")),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                strMap(row, "taggedValues"), objectMap(row, "properties"));
                        relationships.put(relation.id(), relation);
                        changes.add(new Change("add", "relationship", relation.id(), null, relation));
                        affected.add(relation.id());
                        restoredRelationships.add(relationshipToMap(relation));
                    }
                    for (Map<String, Object> row : cmd.mapList("diagrams")) {
                        Diagram diagram = new Diagram(str(row, "id"), DiagramKind.fromCode(str(row, "kind")),
                                str(row, "name"), blankToNull(str(row, "ownerId")),
                                strList(row, "elementIds"), strList(row, "relationshipIds"));
                        diagrams.put(diagram.id(), diagram);
                        changes.add(new Change("add", "diagram", diagram.id(), null, diagram));
                        affected.add(diagram.id());
                        restoredDiagrams.add(diagramToMap(diagram));
                    }
                    for (Map<String, Object> row : cmd.mapList("notations")) {
                        Notation notation = new Notation(str(row, "id"), str(row, "diagramId"),
                                str(row, "elementId"), dbl(row, "x"), dbl(row, "y"),
                                dbl(row, "width", NODE_WIDTH), dbl(row, "height", NODE_HEIGHT),
                                strMap(row, "style"));
                        notations.put(notation.id(), notation);
                        changes.add(new Change("add", "notation", notation.id(), null, notation));
                        affected.add(notation.id());
                        restoredNotations.add(notationToMap(notation));
                    }
                    // 再撤销一次就是重新导入：逆命令带回刚恢复出来的旧内容。
                    inverse = Command.of("RESTORE_IMPORTED", revision, "restore-imported:inverse", Map.of(
                            "elements", List.copyOf(restoredElements),
                            "relationships", List.copyOf(restoredRelationships),
                            "diagrams", List.copyOf(restoredDiagrams),
                            "notations", List.copyOf(restoredNotations)));
                }
                case "RESTORE_SUBTREE" -> {
                    for (Map<String, Object> row : cmd.mapList("elements")) {
                        ModelElement element = new ModelElement(str(row, "id"), str(row, "type"), str(row, "name"),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                orEmpty(str(row, "documentation")), strMap(row, "taggedValues"),
                                blankToNull(str(row, "xmiId")), objectMap(row, "properties"));
                        elements.put(element.id(), element);
                        changes.add(new Change("add", "element", element.id(), null, element));
                        affected.add(element.id());
                    }
                    for (Map<String, Object> row : cmd.mapList("relationships")) {
                        Relationship relation = new Relationship(str(row, "id"), str(row, "type"),
                                str(row, "sourceId"), str(row, "targetId"),
                                orEmpty(str(row, "name")), orEmpty(str(row, "documentation")),
                                strList(row, "stereotypes"), blankToNull(str(row, "ownerId")),
                                strMap(row, "taggedValues"), objectMap(row, "properties"));
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
                case "SET_NOTATIONS" -> {
                    // 自动排布：一次改写一张或全部图的记法坐标。单命令单 revision，
                    // 撤销一步回到排布前，不必按节点数连点撤销。
                    List<Map<String, Object>> inverseItems = new ArrayList<>();
                    List<String> inverseRemove = new ArrayList<>();
                    for (Map<String, Object> row : cmd.mapList("items")) {
                        String diagramId = str(row, "diagramId");
                        String elementId = str(row, "elementId");
                        String id = notationId(diagramId, elementId);
                        Notation before = notations.get(id);
                        if (before == null) {
                            inverseRemove.add(id);
                        } else {
                            inverseItems.add(notationToMap(before));
                        }
                        Notation after = before == null
                                ? placedNotation(diagramId, elementId, dbl(row, "x"), dbl(row, "y"))
                                : new Notation(id, diagramId, elementId, dbl(row, "x"), dbl(row, "y"),
                                        before.width(), before.height(), before.style());
                        notations.put(id, after);
                        changes.add(new Change(before == null ? "add" : "update", "notation", id, before, after));
                        affected.add(id);
                        affected.add(diagramId);
                        affected.add(elementId);
                    }
                    // 仅出现在逆命令里：正向排布新建的记法，撤销时要删掉。
                    for (String id : cmd.strList("removeIds")) {
                        Notation before = notations.remove(id);
                        if (before == null) {
                            continue;
                        }
                        changes.add(new Change("remove", "notation", id, before, null));
                        inverseItems.add(notationToMap(before));
                        affected.add(id);
                        affected.add(before.diagramId());
                    }
                    Map<String, Object> inversePayload = new LinkedHashMap<>();
                    inversePayload.put("items", List.copyOf(inverseItems));
                    inversePayload.put("removeIds", List.copyOf(inverseRemove));
                    inverse = Command.of("SET_NOTATIONS", revision, "set-notations:inverse", inversePayload);
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
                    Relationship relationship = new Relationship(id, cmd.str("type"),
                            cmd.str("sourceId"), cmd.str("targetId"),
                            orEmpty(cmd.str("name")), orEmpty(cmd.str("documentation")),
                            cmd.strList("stereotypes"), null,
                            strMap(cmd.payload(), "taggedValues"),
                            objectMap(cmd.payload(), "properties"));
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
                    // 逆命令必须带回关系的完整模型内容（名称/文档/构造型/属性包），否则撤销会丢属性。
                    Map<String, Object> inversePayload = new LinkedHashMap<>();
                    inversePayload.put("id", id);
                    inversePayload.put("type", before.type());
                    inversePayload.put("sourceId", before.sourceId());
                    inversePayload.put("targetId", before.targetId());
                    inversePayload.put("name", orEmpty(before.name()));
                    inversePayload.put("documentation", orEmpty(before.documentation()));
                    inversePayload.put("stereotypes", before.stereotypes());
                    inversePayload.put("taggedValues", before.taggedValues());
                    inversePayload.put("properties", before.properties());
                    inverse = Command.of("CREATE_RELATIONSHIP", revision, id + ":inverse", inversePayload);
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
                    Notation current = notations.get(notationId);
                    if (current == null) {
                        Notation notation = hasPosition(cmd)
                                ? placedNotation(diagramId, elementId, cmd.decimal("x"), cmd.decimal("y"))
                                : defaultNotation(diagramId, elementId, refs.size() - 1);
                        notations.put(notationId, notation);
                        changes.add(new Change("add", "notation", notationId, null, notation));
                        affected.add(notationId);
                    } else if (hasPosition(cmd)) {
                        // 已在图中但再次拖入：直接更新坐标，保持「单命令落位」语义。
                        Notation moved = new Notation(notationId, diagramId, elementId,
                                cmd.decimal("x"), cmd.decimal("y"),
                                current.width(), current.height(), current.style());
                        notations.put(notationId, moved);
                        changes.add(new Change("update", "notation", notationId, current, moved));
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

    /** 一次删除中被摘掉的模型内容，DELETE_ELEMENT / DELETE_ELEMENTS 共用。 */
    private record DeletedSubtree(List<Map<String, Object>> elements,
                                  List<Map<String, Object>> relationships,
                                  List<Map<String, Object>> notations,
                                  List<Map<String, Object>> diagramRefs) {
    }

    /**
     * 删除一棵子树：连带清理关系、记法与图上的引用。
     *
     * <p>删除是按「所有权」而非「图引用」进行的——元素在图上只是被引用，
     * 因此只把图里的引用摘掉，图本身保留。</p>
     */
    private DeletedSubtree removeSubtree(Set<String> subtree, List<Change> changes, List<String> affected) {
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
        return new DeletedSubtree(removedElements, removedRelationships, removedNotations, diagramRefs);
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

    /** 命令是否携带放置坐标：由 ValidationEngine 先做边界校验，这里只负责写入。 */
    private static boolean hasPosition(Command cmd) {
        return cmd.payload().get("x") instanceof Number && cmd.payload().get("y") instanceof Number;
    }

    /** 拖放落点：服务端权威生成记法，前端不再补发 MOVE_NOTATION。 */
    private static Notation placedNotation(String diagramId, String elementId, double x, double y) {
        return new Notation(notationId(diagramId, elementId), diagramId, elementId,
                x, y, NODE_WIDTH, NODE_HEIGHT, Map.of());
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
        row.put("properties", element.properties());
        return row;
    }

    private static Map<String, Object> relationshipToMap(Relationship relation) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", relation.id());
        row.put("type", relation.type());
        row.put("sourceId", relation.sourceId());
        row.put("targetId", relation.targetId());
        row.put("name", orEmpty(relation.name()));
        row.put("documentation", orEmpty(relation.documentation()));
        row.put("stereotypes", relation.stereotypes());
        row.put("ownerId", orEmpty(relation.ownerId()));
        row.put("taggedValues", relation.taggedValues());
        row.put("properties", relation.properties());
        return row;
    }

    private static Map<String, Object> diagramToMap(Diagram diagram) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", diagram.id());
        row.put("kind", diagram.kind().code());
        row.put("name", diagram.name());
        row.put("ownerId", orEmpty(diagram.ownerId()));
        row.put("elementIds", diagram.elementIds());
        row.put("relationshipIds", diagram.relationshipIds());
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

    /** 扩展属性包：删除-撤销（RESTORE_SUBTREE）时完整恢复，不能丢掉用户填的规范属性。 */
    private static Map<String, Object> objectMap(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (!(value instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getValue() != null) {
                result.put(String.valueOf(entry.getKey()), entry.getValue());
            }
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
