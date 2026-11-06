package com.scofen.model.web.api;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.Patch;
import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;
import com.scofen.model.web.rbac.Permission;
import com.scofen.model.web.rbac.RequiresPermission;
import com.scofen.model.web.project.ProjectRegistry;
import com.scofen.model.xmi.ExchangeBundle;
import com.scofen.model.xmi.ExchangeFormat;
import com.scofen.model.xmi.NotationSidecar;
import com.scofen.model.xmi.ServerRelayout;
import com.scofen.model.xmi.UmlXmiAdapter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * XMI 交换接口：标准 UML 2.5.1 语义 + {@code .di.json} 布局侧车。
 *
 * <p><b>为什么分两个文件</b>：标准 XMI 不承载图类型、图名与坐标，
 * 少了侧车，九张图会塌成一个点。语义文件给别的工具看，
 * 侧车给我们自己还原九图布局。</p>
 *
 * <p><b>导入语义是「整包替换当前项目」</b>，不是逐条合并：
 * 逐条合并要处理 id 冲突、命名唯一与图引用残留，代价高且结果不可预期；
 * 整包替换则天然幂等——导入自己导出的文件，结果与导出前完全一致。
 * 撤销栈里存的是替换前的完整内容，因此撤销同样是一次操作即可回到原状。</p>
 */
@RestController
@RequestMapping("/api/exchange")
public class ExchangeController {

    private final CommandExecutor executor;
    private final UmlXmiAdapter adapter = new UmlXmiAdapter();
    /** 单元测试可直接构造本类；Spring 运行时由 setter 注入。 */
    private ProjectRegistry projects;

    public ExchangeController(CommandExecutor executor) {
        this.executor = executor;
    }

    @Autowired
    public void setProjectRegistry(ProjectRegistry projects) {
        this.projects = projects;
    }

    private CommandExecutor forProject(String projectId) {
        return projects == null ? executor : projects.resolve(projectId);
    }

    /* ---------------- 导出 ---------------- */

    /** 标准 UML 2.5.1 XMI 语义文件。 */
    @GetMapping("/xmi")
    @RequiresPermission(Permission.MODEL_EXPORT)
    public ResponseEntity<String> exportXmi(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        ModelSnapshot snapshot = forProject(projectId).snapshot();
        ExchangeBundle bundle = adapter.exportModel(snapshot);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/xml;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"model.xmi\"")
                .body(bundle.semantic());
    }

    /** 布局侧车：图类型、图名与全部记号坐标。 */
    @GetMapping("/xmi.di.json")
    @RequiresPermission(Permission.MODEL_EXPORT)
    public ResponseEntity<String> exportSidecar(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        ModelSnapshot snapshot = forProject(projectId).snapshot();
        ExchangeBundle bundle = adapter.exportModel(snapshot);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/json;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"model.di.json\"")
                .body(bundle.notationSidecar());
    }

    /** 无损自有格式，作为 XMI 之外的兜底（带全部属性与样式）。 */
    @GetMapping("/scofen.json")
    @RequiresPermission(Permission.MODEL_EXPORT)
    public ResponseEntity<String> exportNative(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        ModelSnapshot snapshot = forProject(projectId).snapshot();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/json;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"model.scofen.json\"")
                .body(com.scofen.model.core.SnapshotCodec.toJson(snapshot));
    }

    /* ---------------- 导入 ---------------- */

    /**
     * 导入请求体：语义文件 + 可选布局侧车。
     *
     * <p>侧车缺省时仍可导入：此时只恢复语义层，九图布局由服务端按类型重新排布，
     * 保证「有侧车保真、没侧车可用」。</p>
     */
    public record ImportRequest(String semantic, String sidecar) {
    }

    @PostMapping("/xmi")
    @RequiresPermission(Permission.MODEL_IMPORT)
    public Patch importXmi(@RequestBody ImportRequest request,
                            @RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId,
                            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        if (request == null || request.semantic() == null || request.semantic().isBlank()) {
            throw new IllegalStateException("缺少 XMI 语义内容");
        }
        ModelSnapshot imported = adapter.importModel(new ExchangeBundle(
                ExchangeFormat.XMI_251, request.semantic(), request.sidecar(), List.of()));
        CommandExecutor current = forProject(projectId);
        ModelSnapshot currentSnapshot = current.snapshot();

        // ① 剥掉导入文件自带的扩展包：通用扩展包是每个项目自带的系统公共内容，
        //    换进来反而会让它与本项目的元模型版本脱节。连带清掉指向它们的引用，
        //    否则替换后的世界里会留下悬空引用。
        imported = stripExtension(imported);

        // ② 项目根 id 归一：导入文件可能来自别的项目，根 id 未必是本地那个。
        //    扩展包挂在本地根下，根 id 不统一就会把扩展包变成孤儿。
        imported = remapRoot(imported, localRootId(currentSnapshot));

        // ③ 没有布局侧车时只吃语义：服务端按元素的主图归属重排九图，
        //    否则用户导入后看到的是九个空图，等于导入失败。
        if (imported.diagrams().isEmpty()) {
            imported = ServerRelayout.relayout(imported);
        }
        Map<String, Object> payload = importPayload(imported, currentSnapshot);
        // 幂等键必须唯一：同一毫秒内连续两次导入用时间戳会撞键，
        // 第二条命令会被幂等缓存直接返回、根本不会落库。
        Command command = Command.of("IMPORT_MODEL", current.revision(),
                "import-xmi-" + java.util.UUID.randomUUID(), payload);
        return current.execute(sessionId, command);
    }

    /**
     * 剥掉导入内容里的通用扩展包子树。
     *
     * <p>扩展包（SysML / UML 的元类与构造型清单）是每个项目自带的系统公共内容，
     * 每个项目的 id 固定一致。导入时保留本地那份，导入文件里带来的那份连同
     * 指向它的关系、图引用与记号一并丢弃——否则替换后的世界里会留下悬空引用。</p>
     */
    private ModelSnapshot stripExtension(ModelSnapshot snapshot) {
        java.util.Set<String> extensionIds = com.scofen.model.metamodel.ExtensionLibrary
                .subtreeIds(snapshot.elements());
        List<ModelElement> elements = snapshot.elements().stream()
                .filter(element -> !extensionIds.contains(element.id()))
                .toList();
        List<Relationship> relationships = snapshot.relationships().stream()
                .filter(relation -> !extensionIds.contains(relation.sourceId())
                        && !extensionIds.contains(relation.targetId()))
                .toList();
        List<Diagram> diagrams = snapshot.diagrams().stream()
                .map(diagram -> new Diagram(diagram.id(), diagram.kind(), diagram.name(), diagram.ownerId(),
                        diagram.elementIds().stream().filter(id -> !extensionIds.contains(id)).toList(),
                        diagram.relationshipIds().stream().filter(id -> !extensionIds.contains(id)).toList()))
                .toList();
        List<Notation> notations = snapshot.notations().stream()
                .filter(notation -> !extensionIds.contains(notation.elementId()))
                .toList();
        return new ModelSnapshot(snapshot.revision(), elements, relationships, diagrams, notations);
    }

    /** 本地项目根元素 id：没有 ownerId 且类型为 Model 的那个元素。 */
    private String localRootId(ModelSnapshot snapshot) {
        return snapshot.elements().stream()
                .filter(element -> (element.ownerId() == null || element.ownerId().isBlank())
                        && "Model".equalsIgnoreCase(element.type()))
                .map(ModelElement::id)
                .findFirst()
                .orElse("model-root");
    }

    /**
     * 把导入内容的项目根 id 归一到本地根 id。
     *
     * <p>导入文件可能来自另一个项目，其根元素 id 未必是 {@code model-root}。
     * 若不归一，本地扩展包（挂在本地根下）会指向一个不存在的根。</p>
     */
    private ModelSnapshot remapRoot(ModelSnapshot snapshot, String localRootId) {
        String importedRootId = snapshot.elements().stream()
                .filter(element -> (element.ownerId() == null || element.ownerId().isBlank())
                        && "Model".equalsIgnoreCase(element.type()))
                .map(ModelElement::id)
                .findFirst()
                .orElse(null);
        if (importedRootId == null || importedRootId.equals(localRootId)) {
            return snapshot;
        }
        List<ModelElement> elements = snapshot.elements().stream()
                .map(element -> new ModelElement(
                        importedRootId.equals(element.id()) ? localRootId : element.id(),
                        element.type(), element.name(), element.stereotypes(),
                        importedRootId.equals(element.ownerId()) ? localRootId : element.ownerId(),
                        element.documentation(), element.taggedValues(), element.xmiId(), element.properties()))
                .toList();
        List<Relationship> relationships = snapshot.relationships().stream()
                .map(relation -> new Relationship(relation.id(), relation.type(),
                        importedRootId.equals(relation.sourceId()) ? localRootId : relation.sourceId(),
                        importedRootId.equals(relation.targetId()) ? localRootId : relation.targetId(),
                        relation.name(), relation.documentation(), relation.stereotypes(),
                        importedRootId.equals(relation.ownerId()) ? localRootId : relation.ownerId(),
                        relation.taggedValues(), relation.properties()))
                .toList();
        List<Diagram> diagrams = snapshot.diagrams().stream()
                .map(diagram -> new Diagram(diagram.id(), diagram.kind(), diagram.name(),
                        importedRootId.equals(diagram.ownerId()) ? localRootId : diagram.ownerId(),
                        diagram.elementIds().stream()
                                .map(id -> importedRootId.equals(id) ? localRootId : id).toList(),
                        diagram.relationshipIds().stream()
                                .map(id -> importedRootId.equals(id) ? localRootId : id).toList()))
                .toList();
        List<Notation> notations = snapshot.notations().stream()
                .map(notation -> new Notation(notation.id(), notation.diagramId(),
                        importedRootId.equals(notation.elementId()) ? localRootId : notation.elementId(),
                        notation.x(), notation.y(), notation.width(), notation.height(), notation.style()))
                .toList();
        return new ModelSnapshot(snapshot.revision(), elements, relationships, diagrams, notations);
    }

    /**
     * 组装整包替换载荷。
     *
     * <p>替换时保留「通用扩展包」——它是每个项目自带的 SysML / UML 元类清单，
     * 不属于用户模型，换进来反而会让扩展包与本项目的元模型版本脱节。
     * 扩展包之外的内容（元素、关系、图、记号）整体替换。</p>
     */
    private Map<String, Object> importPayload(ModelSnapshot imported, ModelSnapshot current) {
        List<Map<String, Object>> elements = new ArrayList<>();
        List<Map<String, Object>> relationships = new ArrayList<>();
        List<Map<String, Object>> diagrams = new ArrayList<>();
        List<Map<String, Object>> notations = new ArrayList<>();

        java.util.Set<String> extensionIds = com.scofen.model.metamodel.ExtensionLibrary
                .subtreeIds(current.elements());

        for (ModelElement element : imported.elements()) {
            if (extensionIds.contains(element.id())) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", element.id());
            row.put("type", element.type());
            row.put("name", element.name());
            row.put("stereotypes", element.stereotypes());
            row.put("ownerId", element.ownerId() == null ? "" : element.ownerId());
            row.put("documentation", element.documentation());
            row.put("taggedValues", element.taggedValues());
            row.put("xmiId", element.xmiId());
            row.put("properties", element.properties());
            elements.add(row);
        }
        for (Relationship relationship : imported.relationships()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", relationship.id());
            row.put("type", relationship.type());
            row.put("sourceId", relationship.sourceId());
            row.put("targetId", relationship.targetId());
            row.put("name", relationship.name());
            row.put("documentation", relationship.documentation());
            row.put("stereotypes", relationship.stereotypes());
            row.put("ownerId", relationship.ownerId() == null ? "" : relationship.ownerId());
            row.put("taggedValues", relationship.taggedValues());
            row.put("properties", relationship.properties());
            relationships.add(row);
        }
        for (Diagram diagram : imported.diagrams()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", diagram.id());
            row.put("kind", diagram.kind().code());
            row.put("name", diagram.name());
            row.put("ownerId", diagram.ownerId() == null ? "" : diagram.ownerId());
            row.put("elementIds", diagram.elementIds());
            row.put("relationshipIds", diagram.relationshipIds());
            diagrams.add(row);
        }
        for (Notation notation : imported.notations()) {
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

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("elements", elements);
        payload.put("relationships", relationships);
        payload.put("diagrams", diagrams);
        payload.put("notations", notations);
        // 逆命令所需的「被替换掉的旧内容」由仓储在应用命令时自行留档，
        // 这里不必再传一遍——那会让载荷体积翻倍。
        return payload;
    }

    /** 侧车内容，供前端展示与校验用（不落库）。 */
    @GetMapping("/sidecar/preview")
    @RequiresPermission(Permission.MODEL_VIEW)
    public Map<String, Object> sidecarPreview(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        ModelSnapshot snapshot = forProject(projectId).snapshot();
        NotationSidecar.Sidecar sidecar = NotationSidecar.of(snapshot.diagrams(), snapshot.notations());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("format", sidecar.format());
        result.put("version", sidecar.version());
        result.put("diagramCount", sidecar.diagrams().size());
        result.put("notationCount", sidecar.notations().size());
        result.put("kinds", sidecar.diagrams().stream().map(entry -> entry.kind()).distinct().toList());
        result.put("expectedKinds", DiagramKind.values().length);
        return result;
    }
}
