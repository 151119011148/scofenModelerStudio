package com.scofen.model.core;

import com.scofen.model.metamodel.ContainmentRules;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.metamodel.Relationship;
import com.scofen.model.metamodel.RelationshipType;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 服务端规则引擎。命名唯一性用规范化字符串比较，
 * 对应 MySQL 8.4 默认 utf8mb4_0900_ai_ci 不区分大小写/重音，不能只靠 UNIQUE 约束。
 *
 * <p>新建元素必须同时满足：类型在元模型注册表内、父元素存在且包含关系合规、
 * 同命名空间命名唯一、名称格式合法、若加入图则该图允许此类型。</p>
 */
public final class ValidationEngine {

    /** 画布上限与节点尺寸：服务端下发，前端拖拽用同一组常量做边界约束。 */
    public static final double CANVAS_MAX_X = 480.0;
    public static final double CANVAS_MAX_Y = 340.0;
    public static final double NODE_WIDTH = InMemoryModelRepository.NODE_WIDTH;
    public static final double NODE_HEIGHT = InMemoryModelRepository.NODE_HEIGHT;

    public void validate(Command cmd, InMemoryModelRepository repository) {
        switch (cmd.type()) {
            case "CREATE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("type"), "type");
                require(cmd.str("name"), "name");
                ElementType child = ElementType.fromAny(cmd.str("type"))
                        .orElseThrow(() -> new ValidationException("Unknown element type: " + cmd.str("type")));
                assertNameFormat(cmd.str("name"));
                assertContainment(repository, cmd.str("ownerId"), child);
                assertNameIsUnique(repository, cmd.str("ownerId"), cmd.str("name"), null);
                assertOptionalPosition(cmd);
                // 建元素时即可带上规范元属性（如「扩展的元类」），引用目标必须已存在。
                Map<String, Object> properties = cmdObjectMap(cmd, "properties");
                if (!properties.isEmpty()) {
                    ModelElement element = new ModelElement(cmd.str("id"), cmd.str("type"), cmd.str("name"),
                            cmd.strList("stereotypes"), blankToNull(cmd.str("ownerId")),
                            orEmpty(cmd.str("documentation")), Map.of(), blankToNull(cmd.str("xmiId")),
                            properties);
                    assertElementProperties(repository, Map.of(), element);
                }
                String diagramId = cmd.str("diagramId");
                if (diagramId != null && !diagramId.isBlank()) {
                    Diagram diagram = repository.findDiagram(diagramId)
                            .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                    assertDiagramAllows(diagram.kind(), child);
                }
            }
            case "RENAME_ELEMENT" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                assertNameFormat(cmd.str("name"));
                ModelElement current = repository.findElement(cmd.str("id"))
                        .orElseThrow(() -> new ValidationException("Unknown element: " + cmd.str("id")));
                assertNameIsUnique(repository, current.ownerId(), cmd.str("name"), current.id());
            }
            case "UPDATE_DOCUMENTATION" -> {
                require(cmd.str("id"), "id");
                if (!repository.elementExists(cmd.str("id"))) {
                    throw new ValidationException("Unknown element: " + cmd.str("id"));
                }
            }
            case "UPDATE_PROPERTY" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("key"), "key");
                String targetId = cmd.str("id");
                String key = cmd.str("key");
                boolean remove = Boolean.TRUE.equals(cmd.payload().get("remove"));
                Object value = cmd.payload().get("value");

                ModelElement element = repository.findElement(targetId).orElse(null);
                if (element != null) {
                    ElementType type = ElementType.fromAny(element.type())
                            .orElseThrow(() -> new ValidationException("Unknown element type: " + element.type()));
                    PropertyCatalog.PropertySpec spec = PropertyCatalog.find(type, key);
                    if (spec == null) {
                        throw new ValidationException("属性不在 " + type.umlName() + " 的 UML/SysML 规范清单中: " + key);
                    }
                    if (!spec.editable()) {
                        throw new ValidationException("计算属性 / 派生属性不可修改（UML 规范只读）: " + key);
                    }
                    assertPropertyValue(repository, spec, value, remove);
                    if ("name".equals(key) && !remove) {
                        assertNameFormat(String.valueOf(value));
                        assertNameIsUnique(repository, element.ownerId(), String.valueOf(value), element.id());
                    }
                    return;
                }

                // 关系同样是模型对象：属性窗口按关系类型的元类链校验，端点与标识只读。
                Relationship relationship = repository.findRelationship(targetId)
                        .orElseThrow(() -> new ValidationException("Unknown model object: " + targetId));
                RelationshipType relType = RelationshipType.fromAny(relationship.type())
                        .orElseThrow(() -> new ValidationException(
                                "Unknown relationship type: " + relationship.type()));
                PropertyCatalog.PropertySpec relSpec = PropertyCatalog.find(relType, key);
                if (relSpec == null) {
                    throw new ValidationException("属性不在关系 «" + relType.code()
                            + "» 的 UML/SysML 规范清单中: " + key);
                }
                if (!relSpec.editable()) {
                    throw new ValidationException("计算属性 / 派生属性不可修改（UML 规范只读）: " + key);
                }
                assertPropertyValue(repository, relSpec, value, remove);
                if ("name".equals(key) && !remove) {
                    assertNameFormat(String.valueOf(value));
                }
            }
            case "DELETE_ELEMENT" -> {
                require(cmd.str("id"), "id");
                ModelElement target = repository.findElement(cmd.str("id"))
                        .orElseThrow(() -> new ValidationException("Unknown element: " + cmd.str("id")));
                if (isProjectRoot(target)) {
                    throw new ValidationException(
                            "项目根节点不可删除：项目根 Package 是模型树的唯一顶层节点；"
                                    + "如需清空项目请删除其下的子元素。");
                }
                assertNotExtensionRoot(target);
            }
            case "DELETE_ELEMENTS" -> {
                List<String> ids = cmd.strList("ids");
                if (ids.isEmpty()) {
                    throw new ValidationException("Missing required field: ids");
                }
                for (String id : ids) {
                    ModelElement target = repository.findElement(id)
                            .orElseThrow(() -> new ValidationException("Unknown element: " + id));
                    // 与单条 DELETE_ELEMENT 保持同一套保护，避免批量通道绕过拒删根。
                    if (isProjectRoot(target)) {
                        throw new ValidationException("项目根节点不可删除");
                    }
                    assertNotExtensionRoot(target);
                }
            }
            case "CREATE_ELEMENTS" -> {
                // 批量建元素：通用扩展包等系统内容走这条通道。
                // 校验要「批内可见」——同一批里的父元素与被引用的元类尚未落库，
                // 因此包含关系与命名唯一性都必须把待建元素一并算进去。
                List<Map<String, Object>> rows = cmd.mapList("elements");
                if (rows.isEmpty()) {
                    throw new ValidationException("Missing required field: elements");
                }
                Map<String, ModelElement> pending = new LinkedHashMap<>();
                for (Map<String, Object> row : rows) {
                    String id = rowString(row, "id");
                    require(id, "id");
                    String typeName = rowString(row, "type");
                    require(typeName, "type");
                    String name = rowString(row, "name");
                    require(name, "name");
                    ElementType child = ElementType.fromAny(typeName)
                            .orElseThrow(() -> new ValidationException("Unknown element type: " + typeName));
                    assertNameFormat(name);
                    assertContainment(repository, pending, rowString(row, "ownerId"), child);
                    assertNameIsUnique(repository, pending, rowString(row, "ownerId"), name, null);
                    ModelElement element = new ModelElement(id, typeName, name,
                            rowStringList(row, "stereotypes"), blankToNull(rowString(row, "ownerId")),
                            rowString(row, "documentation") == null ? "" : rowString(row, "documentation"),
                            rowStringMap(row, "taggedValues"), blankToNull(rowString(row, "xmiId")),
                            rowObjectMap(row, "properties"));
                    assertElementProperties(repository, pending, element);
                    pending.put(id, element);
                }
            }
            case "IMPORT_MODEL" -> {
                // 整包替换：一次性导入整套模型，元素、关系、图与记号只产生一个
                // revision 与一个 Patch。逐条 CREATE_ELEMENT 会把 revision 顶高、
                // WS 广播打爆，因此单独开这条通道。
                //
                // 校验的关键在于「校验的是替换后的世界」：旧内容会被整体清掉，
                // 因此命名唯一性与包含关系不能拿旧内容来比——否则导入自己导出的
                // 文件会因为「同名旧元素还在库里」而被误判为重名。
                List<Map<String, Object>> rows = cmd.mapList("elements");
                if (rows.isEmpty()) {
                    throw new ValidationException("Missing required field: elements");
                }
                // 扩展包保留在项目里，因此它既参与命名唯一性，也算「已存在」。
                Set<String> keepIds = ExtensionLibrary.subtreeIds(repository.elements());
                Map<String, ModelElement> pending = new LinkedHashMap<>();
                // 第一遍：只建索引与基本格式检查。包含关系、命名唯一性与引用存在性
                // 都要看整批，因此放到第二遍——否则「父元素排在子元素后面」
                // 这种合法的树形顺序会被误判成「所有者不存在」。
                for (Map<String, Object> row : rows) {
                    String id = rowString(row, "id");
                    require(id, "id");
                    String typeName = rowString(row, "type");
                    require(typeName, "type");
                    String name = rowString(row, "name");
                    require(name, "name");
                    ElementType.fromAny(typeName)
                            .orElseThrow(() -> new ValidationException("Unknown element type: " + typeName));
                    if (pending.containsKey(id)) {
                        throw new ValidationException("Duplicate element id in import: " + id);
                    }
                    assertNameFormat(name);
                    pending.put(id, new ModelElement(id, typeName, name,
                            rowStringList(row, "stereotypes"), blankToNull(rowString(row, "ownerId")),
                            rowString(row, "documentation") == null ? "" : rowString(row, "documentation"),
                            rowStringMap(row, "taggedValues"), blankToNull(rowString(row, "xmiId")),
                            rowObjectMap(row, "properties")));
                }
                // 第二遍：在「替换后的世界」里做关系性校验。
                for (ModelElement element : pending.values()) {
                    ElementType child = ElementType.fromAny(element.type()).orElseThrow();
                    // 包含关系：父元素要么在本批，要么是保留下来的扩展包成员。
                    assertImportContainment(repository, pending, keepIds, element.ownerId(), child, element.id());
                    assertImportNameIsUnique(repository, pending, keepIds,
                            element.ownerId(), element.name(), element.id());
                    assertImportProperties(pending, keepIds, element);
                }
                for (Map<String, Object> row : cmd.mapList("relationships")) {
                    String id = rowString(row, "id");
                    require(id, "id");
                    String type = rowString(row, "type");
                    require(type, "type");
                    RelationshipType.fromAny(type)
                            .orElseThrow(() -> new ValidationException("Unknown relationship type: " + type));
                    String source = rowString(row, "sourceId");
                    String target = rowString(row, "targetId");
                    require(source, "sourceId");
                    require(target, "targetId");
                    // 端点必须存在于替换后的世界：本批元素或保留下来的扩展包成员。
                    if (!pending.containsKey(source) && !keepIds.contains(source)) {
                        throw new ValidationException("Relationship endpoint missing: " + source);
                    }
                    if (!pending.containsKey(target) && !keepIds.contains(target)) {
                        throw new ValidationException("Relationship endpoint missing: " + target);
                    }
                }
                Set<String> diagramIds = new LinkedHashSet<>();
                for (Map<String, Object> row : cmd.mapList("diagrams")) {
                    String id = rowString(row, "id");
                    require(id, "id");
                    require(rowString(row, "name"), "name");
                    DiagramKind kind;
                    try {
                        kind = DiagramKind.fromCode(rowString(row, "kind"));
                    } catch (IllegalArgumentException ex) {
                        throw new ValidationException("Unknown diagram kind: " + rowString(row, "kind"));
                    }
                    if (!diagramIds.add(id)) {
                        throw new ValidationException("Duplicate diagram id in import: " + id);
                    }
                    for (String ref : rowStringList(row, "elementIds")) {
                        ModelElement element = pending.get(ref);
                        if (element == null && keepIds.contains(ref)) {
                            element = repository.findElement(ref).orElse(null);
                        }
                        if (element == null) {
                            throw new ValidationException("Diagram references missing element: " + ref);
                        }
                        ElementType.fromAny(element.type()).ifPresent(type -> assertDiagramAllows(kind, type));
                    }
                }
                for (Map<String, Object> row : cmd.mapList("notations")) {
                    String diagramId = rowString(row, "diagramId");
                    String elementId = rowString(row, "elementId");
                    require(diagramId, "diagramId");
                    require(elementId, "elementId");
                    if (!diagramIds.contains(diagramId)) {
                        throw new ValidationException("Unknown diagram: " + diagramId);
                    }
                    if (!pending.containsKey(elementId) && !keepIds.contains(elementId)) {
                        throw new ValidationException("Unknown element: " + elementId);
                    }
                }
            }
            case "RESTORE_IMPORTED" -> {
                // 撤销导入：校验还原出来的内容自身是否合法。
                if (cmd.mapList("elements").isEmpty()) {
                    throw new ValidationException("Nothing to restore");
                }
            }
            case "RESTORE_SUBTREE" -> {
                require(cmd.str("rootId"), "rootId");
                if (cmd.mapList("elements").isEmpty()) {
                    throw new ValidationException("Nothing to restore");
                }
            }
            case "MOVE_NOTATION" -> {
                String diagramId = cmd.str("diagramId");
                String elementId = cmd.str("elementId");
                require(diagramId, "diagramId");
                require(elementId, "elementId");
                Diagram diagram = repository.findDiagram(diagramId)
                        .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                if (!diagram.elementIds().contains(elementId)) {
                    throw new ValidationException("Element " + elementId + " is not on diagram " + diagramId);
                }
                double x = cmd.decimal("x");
                double y = cmd.decimal("y");
                if (!Double.isFinite(x) || !Double.isFinite(y)
                        || x < 0 || y < 0 || x > CANVAS_MAX_X || y > CANVAS_MAX_Y) {
                    throw new ValidationException("Notation position out of canvas: " + x + "," + y);
                }
            }
            case "DELETE_NOTATION" -> require(cmd.str("id"), "id");
            case "CREATE_RELATIONSHIP" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("type"), "type");
                String source = cmd.str("sourceId");
                String target = cmd.str("targetId");
                if (!repository.elementExists(source) || !repository.elementExists(target)) {
                    throw new ValidationException("Relationship endpoints must exist: " + source + " -> " + target);
                }
                RelationshipType relType = RelationshipType.fromAny(cmd.str("type"))
                        .orElseThrow(() -> new ValidationException(
                                "Unknown relationship type: " + cmd.str("type")));
                // 带上 diagramId 时按图规范校验：组件工具箱只显示当前图允许的关系，服务端不信任前端过滤。
                String diagramId = cmd.str("diagramId");
                if (diagramId != null && !diagramId.isBlank()) {
                    Diagram diagram = repository.findDiagram(diagramId)
                            .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                    if (!MetamodelRegistry.allowsRelationship(diagram.kind(), relType)) {
                        throw new ValidationException("Relationship «" + relType.code()
                                + "» is not allowed on " + diagram.kind().label());
                    }
                }
                if ("generalization".equals(cmd.str("type"))
                        && createsCycle(target, source, repository.relationships())) {
                    throw new ValidationException("Generalization cycle is not allowed");
                }
            }
            case "DELETE_RELATIONSHIP", "DELETE_DIAGRAM" -> require(cmd.str("id"), "id");
            case "RENAME_DIAGRAM" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                if (repository.findDiagram(cmd.str("id")).isEmpty()) {
                    throw new ValidationException("Unknown diagram: " + cmd.str("id"));
                }
            }
            case "CREATE_DIAGRAM" -> {
                require(cmd.str("id"), "id");
                require(cmd.str("name"), "name");
                require(cmd.str("kind"), "kind");
                DiagramKind kind;
                try {
                    kind = DiagramKind.fromCode(cmd.str("kind"));
                } catch (IllegalArgumentException ex) {
                    throw new ValidationException("Unknown diagram kind: " + cmd.str("kind"));
                }
                for (String ref : cmd.strList("elementIds")) {
                    ModelElement element = repository.findElement(ref)
                            .orElseThrow(() -> new ValidationException("Diagram references missing element: " + ref));
                    ElementType.fromAny(element.type()).ifPresent(type -> assertDiagramAllows(kind, type));
                }
            }
            case "ADD_TO_DIAGRAM" -> {
                String diagramId = cmd.str("diagramId");
                String elementId = cmd.str("elementId");
                Diagram diagram = repository.findDiagram(diagramId)
                        .orElseThrow(() -> new ValidationException("Unknown diagram: " + diagramId));
                ModelElement element = repository.findElement(elementId)
                        .orElseThrow(() -> new ValidationException("Unknown element: " + elementId));
                ElementType.fromAny(element.type()).ifPresent(type -> assertDiagramAllows(diagram.kind(), type));
                assertOptionalPosition(cmd);
            }
            case "REMOVE_FROM_DIAGRAM" -> require(cmd.str("diagramId"), "diagramId");
            default -> throw new ValidationException("Unknown command type: " + cmd.type());
        }
    }

    /** 只按 affectedIds 涉及的分组做增量校验，结果随 Patch 广播。 */
    public String validateIncremental(ModelSnapshot snapshot, List<String> affectedIds) {
        List<String> issues = new ArrayList<>();
        Set<String> elementIds = new HashSet<>();
        for (ModelElement element : snapshot.elements()) {
            elementIds.add(element.id());
        }
        Set<String> diagramIds = new HashSet<>();
        for (Diagram diagram : snapshot.diagrams()) {
            diagramIds.add(diagram.id());
            for (String ref : diagram.elementIds()) {
                if (!elementIds.contains(ref)) {
                    issues.add("diagram " + diagram.id() + " references missing element " + ref);
                }
            }
        }
        for (Notation notation : snapshot.notations()) {
            if (!elementIds.contains(notation.elementId())
                    && (affectedIds.contains(notation.elementId()) || affectedIds.contains(notation.id()))) {
                issues.add("notation " + notation.id() + " has dangling element");
            }
            if (!diagramIds.contains(notation.diagramId()) && affectedIds.contains(notation.id())) {
                issues.add("notation " + notation.id() + " has dangling diagram");
            }
        }
        for (Relationship relationship : snapshot.relationships()) {
            if (!elementIds.contains(relationship.sourceId()) && affectedIds.contains(relationship.sourceId())) {
                issues.add("relationship " + relationship.id() + " has dangling source");
            }
            if (!elementIds.contains(relationship.targetId()) && affectedIds.contains(relationship.targetId())) {
                issues.add("relationship " + relationship.id() + " has dangling target");
            }
        }
        for (ModelElement element : snapshot.elements()) {
            if (!affectedIds.contains(element.id())) {
                continue;
            }
            for (ModelElement other : snapshot.elements()) {
                if (!element.id().equals(other.id())
                        && normalizeOwner(element.ownerId()).equals(normalizeOwner(other.ownerId()))
                        && normalize(element.name()).equals(normalize(other.name()))) {
                    issues.add("duplicate name in namespace " + normalizeOwner(element.ownerId())
                            + ": " + element.name());
                    break;
                }
            }
        }
        return issues.isEmpty() ? "ok" : String.join("; ", issues);
    }

/** 所有权规则：根节点只能是顶层容器；非根节点必须挂在允许包含该类型的父元素下。 */
    private void assertContainment(InMemoryModelRepository repository, String ownerId, ElementType child) {
        assertContainment(repository, Map.of(), ownerId, child);
    }

    /**
     * 所有权规则（含批内元素）。
     *
     * <p>{@code pending} 是同一条批量命令里尚未落库的元素：通用扩展包的子包与元类
     * 都在同一批里创建，父元素此时还不在仓储中，必须一并纳入判断。</p>
     */
    private void assertContainment(InMemoryModelRepository repository, Map<String, ModelElement> pending,
                                  String ownerId, ElementType child) {
        if (ownerId == null || ownerId.isBlank()) {
            if (!ContainmentRules.isRootAllowed(child)) {
                throw new ValidationException("Root element must be one of "
                        + ContainmentRules.ROOT_TYPES + "; got " + child);
            }
            // 项目根固定是 Package：Model 必须作为子元素建在根下，不能另起一个顶层节点，
            // 否则模型树会冒出第二个「看起来像项目根」的 Model。
            if (child == ElementType.MODEL) {
                throw new ValidationException(
                        "Model 必须建在项目根 Package 下，不能作为顶层元素");
            }
            return;
        }
        ModelElement parent = pending.get(ownerId);
        if (parent == null) {
            parent = repository.findElement(ownerId)
                    .orElseThrow(() -> {
                        if (repository.findDiagram(ownerId).isPresent()) {
                            throw new ValidationException(
                                    "Containment violation (SysML 规范): 不能在「图」下创建模型元素；"
                                            + "元素必须挂在包/块等模型元素下，图仅通过引用承载元素。");
                        }
                        throw new ValidationException("Owner element not found: " + ownerId);
                    });
        }
        ModelElement owner = parent;
        ElementType parentType = ElementType.fromAny(owner.type())
                .orElseThrow(() -> new ValidationException("Unknown owner element type: " + owner.type()));
        if (!ContainmentRules.allows(parentType, child)) {
            throw new ValidationException("Containment rule violation: " + parentType.label()
                    + " (" + parentType + ") cannot own " + child.label() + " (" + child + ")");
        }
    }

    /**
     * 项目根判定：id 固定为 {@code model-root} 的顶层元素。
     *
     * <p>按 id 而不是「所有顶层元素」判定：外部 XMI 常带多个顶层 Package，
     * 它们不该被当成项目根，否则拒删保护与单根语义会误伤合法模型。
     * 项目根的类型固定是 Package（见 {@link ProjectRoot}），存量快照里曾是 Model，
     * 回载时由 {@code ProjectRoot.normalize} 归一。</p>
     */
    private static boolean isProjectRoot(ModelElement element) {
        return ProjectRoot.isRoot(element) && ProjectRoot.ID.equals(element.id());
    }

    /**
     * 导入时的包含关系校验：在「替换后的世界」里判断。
     *
     * <p>与普通建元素的差别只有一处：父元素可以来自保留的扩展包子树，
     * 也可以来自本批；而库里那些即将被清掉的旧元素不算数。</p>
     */
    private void assertImportContainment(InMemoryModelRepository repository, Map<String, ModelElement> pending,
                                         Set<String> keepIds, String ownerId, ElementType child, String selfId) {
        if (ownerId == null || ownerId.isBlank()) {
            if (!ContainmentRules.isRootAllowed(child)) {
                throw new ValidationException("Root element must be one of "
                        + ContainmentRules.ROOT_TYPES + "; got " + child);
            }
            // 项目根固定是 Package：导入文件里的顶层 Model 一律不收。
            // 外部 XMI 的单一根会先被 ProjectRoot.normalize 归一成 Package，
            // 能走到这里的说明是额外的顶层 Model，收进来会破坏单根语义。
            if (child == ElementType.MODEL) {
                throw new ValidationException(
                        "Model 必须建在项目根 Package 下，不能作为顶层元素");
            }
            return;
        }
        ModelElement found = pending.get(ownerId);
        if (found == null && keepIds.contains(ownerId)) {
            found = repository.findElement(ownerId).orElse(null);
        }
        if (found == null) {
            throw new ValidationException("Owner element not found: " + ownerId);
        }
        final ModelElement parent = found;
        ElementType parentType = ElementType.fromAny(parent.type())
                .orElseThrow(() -> new ValidationException("Unknown owner element type: " + parent.type()));
        if (!ContainmentRules.allows(parentType, child)) {
            throw new ValidationException("Containment rule violation: " + parentType.label()
                    + " (" + parentType + ") cannot own " + child.label() + " (" + child + ")");
        }
    }

    /**
     * 导入时的命名唯一性：在「替换后的世界」里判断。
     *
     * <p>只与本批元素和保留的扩展包元素比较——库里即将被清掉的旧元素不算数，
     * 否则导入自己导出的文件会被误判为重名。</p>
     */
    private void assertImportNameIsUnique(InMemoryModelRepository repository, Map<String, ModelElement> pending,
                                           Set<String> keepIds, String ownerId, String name, String selfId) {
        String owner = normalizeOwner(ownerId);
        String normalized = normalize(name);
        for (ModelElement element : repository.elements()) {
            if (!keepIds.contains(element.id()) || Objects.equals(element.id(), selfId)) {
                continue;
            }
            if (normalizeOwner(element.ownerId()).equals(owner)
                    && normalize(element.name()).equals(normalized)) {
                throw new ValidationException("Duplicate element name in namespace " + owner + ": " + name);
            }
        }
        for (ModelElement element : pending.values()) {
            if (Objects.equals(element.id(), selfId)) {
                continue;
            }
            if (normalizeOwner(element.ownerId()).equals(owner)
                    && normalize(element.name()).equals(normalized)) {
                throw new ValidationException("Duplicate element name in namespace " + owner + ": " + name);
            }
        }
    }

    /**
     * 导入时的引用型属性校验：目标必须在本批或保留的扩展包里。
     *
     * <p>与 {@link #assertElementProperties} 的差别在于不查仓储——
     * 仓储里的旧元素马上要被清掉，引用它们等于留下悬空引用。</p>
     */
    private void assertImportProperties(Map<String, ModelElement> pending, Set<String> keepIds,
                                        ModelElement element) {
        ElementType type = ElementType.fromAny(element.type()).orElse(null);
        if (type == null) {
            return;
        }
        for (Map.Entry<String, Object> entry : element.properties().entrySet()) {
            PropertyCatalog.PropertySpec spec = PropertyCatalog.find(type, entry.getKey());
            if (spec == null || !PropertyCatalog.referencesElement(spec)) {
                continue;
            }
            for (String reference : referenceValues(entry.getValue())) {
                if (!pending.containsKey(reference) && !keepIds.contains(reference)) {
                    throw new ValidationException("引用的元素不存在: " + entry.getKey() + " → " + reference);
                }
            }
        }
    }

    /**
     * 通用扩展包是每个项目的公共内容，不允许整包删除。
     *
     * <p>删掉扩展包等于抽掉全项目的元类与构造型，所有「扩展的元类」引用都会悬空。
     * 包内的元类、构造型仍可自行增删。</p>
     */
    private static void assertNotExtensionRoot(ModelElement element) {
        if (ExtensionLibrary.isRoot(element.id())) {
            throw new ValidationException(
                    "通用扩展包不可删除：SysML / UML 的元类、构造型与标准库随项目提供，"
                            + "如需裁剪请删除包内的具体元类、构造型或类型。");
        }
    }

    /**
     * CREATE_ELEMENT / ADD_TO_DIAGRAM 可携带 x、y（拖放落点）。
     * 未提供时走默认格点布局；提供时必须与 MOVE_NOTATION 使用同一套画布边界。
     */
    private void assertOptionalPosition(Command cmd) {
        if (cmd.payload().get("x") == null && cmd.payload().get("y") == null) {
            return;
        }
        double x = cmd.decimal("x");
        double y = cmd.decimal("y");
        if (!Double.isFinite(x) || !Double.isFinite(y)
                || x < 0 || y < 0 || x > CANVAS_MAX_X || y > CANVAS_MAX_Y) {
            throw new ValidationException("Notation position out of canvas: " + x + "," + y);
        }
    }

    private void assertDiagramAllows(DiagramKind kind, ElementType type) {
        if (!MetamodelRegistry.allows(kind, type)) {
            throw new ValidationException("Element type " + type
                    + " is not allowed on " + kind.label());
        }
    }

    /**
     * 通用属性写入的值类型校验：与 PropertyCatalog 声明的 ValueKind 一致。
     *
     * <p>引用型属性额外要求被引用的元素真实存在——界面上引用以「缩略图 + 名称」呈现，
     * 指向不存在的 id 只会显示成「未引用的元素」，属于脏数据。</p>
     */
    private void assertPropertyValue(InMemoryModelRepository repository,
            PropertyCatalog.PropertySpec spec, Object value, boolean remove) {
        if (remove) {
            return;
        }
        if (value == null) {
            throw new ValidationException("Missing property value: " + spec.key());
        }
        if ("taggedValues".equals(spec.key())) {
            if (!(value instanceof Map<?, ?>)) {
                throw new ValidationException("taggedValues 必须是 JSON 对象");
            }
            return;
        }
        switch (spec.kind()) {
            case BOOLEAN -> {
                if (!(value instanceof Boolean)) {
                    throw new ValidationException("Boolean property expects true/false: " + spec.key());
                }
            }
            case INTEGER, REAL -> {
                if (!(value instanceof Number)) {
                    throw new ValidationException("Numeric property expects a number: " + spec.key());
                }
            }
            case UNLIMITED_NATURAL -> {
                if (!(value instanceof Number) && !"*".equals(String.valueOf(value))) {
                    throw new ValidationException("UnlimitedNatural expects a number or '*': " + spec.key());
                }
            }
            case ENUM -> {
                if (!spec.options().contains(String.valueOf(value))) {
                    throw new ValidationException("Invalid enumeration value for " + spec.key()
                            + ": " + value + " (allowed: " + spec.options() + ")");
                }
            }
            case REFERENCE_LIST -> {
                if (!(value instanceof List<?>)) {
                    throw new ValidationException("List property expects an array: " + spec.key());
                }
                for (Object item : (List<?>) value) {
                    assertReferenceExists(repository, spec, item);
                }
            }
            case STRING_LIST -> {
                if (!(value instanceof List<?>)) {
                    throw new ValidationException("List property expects an array: " + spec.key());
                }
            }
            case REFERENCE -> {
                if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
                    throw new ValidationException("Text property expects a scalar: " + spec.key());
                }
                assertReferenceExists(repository, spec, value);
            }
            case STRING, TEXT -> {
                if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
                    throw new ValidationException("Text property expects a scalar: " + spec.key());
                }
            }
        }
    }

    /** 引用型属性的目标元素必须存在于当前模型，否则拒绝写入。 */
    private void assertReferenceExists(InMemoryModelRepository repository,
            PropertyCatalog.PropertySpec spec, Object value) {
        if (!PropertyCatalog.referencesElement(spec)) {
            // 少数引用型属性指向的是元模型或表达式文本，不做存在性校验。
            return;
        }
        String id = String.valueOf(value).trim();
        if (id.isEmpty()) {
            throw new ValidationException("引用属性不能为空: " + spec.key());
        }
        if (!repository.elementExists(id)) {
            throw new ValidationException("引用的元素不存在: " + spec.key() + " → " + id);
        }
    }

    private void assertNameFormat(String name) {
        if (name.length() > 120) {
            throw new ValidationException("Element name is too long (max 120 characters)");
        }
        for (int i = 0; i < name.length(); i++) {
            if (Character.isISOControl(name.charAt(i))) {
                throw new ValidationException("Element name must not contain control characters");
            }
        }
    }

    private void assertNameIsUnique(InMemoryModelRepository repository, String ownerId, String name, String selfId) {
        assertNameIsUnique(repository, Map.of(), ownerId, name, selfId);
    }

    /** 同命名空间命名唯一（含批内元素）：批量建元素时同批重名也要挡住。 */
    private void assertNameIsUnique(InMemoryModelRepository repository, Map<String, ModelElement> pending,
                                    String ownerId, String name, String selfId) {
        String owner = normalizeOwner(ownerId);
        String normalized = normalize(name);
        for (ModelElement element : repository.elements()) {
            if (Objects.equals(element.id(), selfId)) {
                continue;
            }
            if (normalizeOwner(element.ownerId()).equals(owner) && normalize(element.name()).equals(normalized)) {
                throw new ValidationException("Duplicate element name in namespace " + owner + ": " + name);
            }
        }
        for (ModelElement element : pending.values()) {
            if (Objects.equals(element.id(), selfId)) {
                continue;
            }
            if (normalizeOwner(element.ownerId()).equals(owner) && normalize(element.name()).equals(normalized)) {
                throw new ValidationException("Duplicate element name in namespace " + owner + ": " + name);
            }
        }
    }

    /**
     * 批量建元素时的属性值校验：引用型属性指向的元素必须已存在或同批创建。
     *
     * <p>通用扩展包里的元类通过「扩展的元类」互相引用，这些目标往往就在同一批里，
     * 因此存在性判断必须把批内元素算进去。</p>
     */
    private void assertElementProperties(InMemoryModelRepository repository,
                                          Map<String, ModelElement> pending, ModelElement element) {
        ElementType type = ElementType.fromAny(element.type()).orElse(null);
        if (type == null) {
            return;
        }
        for (Map.Entry<String, Object> entry : element.properties().entrySet()) {
            PropertyCatalog.PropertySpec spec = PropertyCatalog.find(type, entry.getKey());
            if (spec == null || !PropertyCatalog.referencesElement(spec)) {
                continue;
            }
            for (String reference : referenceValues(entry.getValue())) {
                if (!repository.elementExists(reference) && !pending.containsKey(reference)) {
                    throw new ValidationException("引用的元素不存在: " + entry.getKey() + " → " + reference);
                }
            }
        }
    }

    /** 引用型属性值可能是单个 id，也可能是一组 id。 */
    private static List<String> referenceValues(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf)
                    .map(String::trim).filter(item -> !item.isEmpty()).toList();
        }
        if (value == null) {
            return List.of();
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? List.of() : List.of(text);
    }

    private boolean createsCycle(String start, String target, Collection<Relationship> existing) {
        Map<String, List<String>> parents = new HashMap<>();
        for (Relationship relationship : existing) {
            if ("generalization".equals(relationship.type())) {
                parents.computeIfAbsent(relationship.sourceId(), key -> new ArrayList<>()).add(relationship.targetId());
            }
        }
        return reaches(start, target, parents, new HashSet<>());
    }

    private boolean reaches(String node, String target, Map<String, List<String>> parents, Set<String> seen) {
        if (node.equals(target)) {
            return true;
        }
        if (!seen.add(node)) {
            return false;
        }
        for (String parent : parents.getOrDefault(node, List.of())) {
            if (reaches(parent, target, parents, seen)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeOwner(String ownerId) {
        return ownerId == null ? "" : ownerId.trim();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static void require(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ValidationException("Missing required field: " + field);
        }
    }

    /* ── 批量命令的元素行读取（CREATE_ELEMENTS 的 payload 是一组元素行） ── */

    /** 命令 payload 里的对象型字段（CREATE_ELEMENT 的规范元属性包）。 */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> cmdObjectMap(Command cmd, String key) {
        Object value = cmd.payload().get(key);
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

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    private static String rowString(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static List<String> rowStringList(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().map(String::valueOf).toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> rowStringMap(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (!(value instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> rowObjectMap(Map<String, Object> row, String key) {
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

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
