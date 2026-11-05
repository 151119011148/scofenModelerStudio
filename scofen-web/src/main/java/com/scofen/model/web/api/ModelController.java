package com.scofen.model.web.api;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.Patch;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.ContainmentRules;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.RelationshipType;
import com.scofen.model.web.project.ProjectRegistry;
import com.scofen.model.web.ws.PatchBroker;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ModelController {

    public static final String PRODUCT_NAME = "Scofen Modeler Studio";
    public static final String TAGLINE = "One model. Nine views.";

    private final CommandExecutor executor;
    private final PatchBroker broker;
    private final PersistenceService persistence;
    /** 单元测试可直接构造本类；Spring 运行时注入多项目路由。 */
    private ProjectRegistry projects;

    public ModelController(CommandExecutor executor, PatchBroker broker, PersistenceService persistence) {
        this.executor = executor;
        this.broker = broker;
        this.persistence = persistence;
    }

    @Autowired
    public void setProjectRegistry(ProjectRegistry projects) {
        this.projects = projects;
    }

    private CommandExecutor forProject(String projectId) {
        return projects == null ? executor : projects.resolve(projectId);
    }

    public Map<String, Object> health(String sessionId) {
        return health(sessionId, "");
    }

    @GetMapping("/health")
    public Map<String, Object> health(
            @RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId,
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        CommandExecutor current = forProject(projectId);
        return Map.of(
                "status", "UP",
                "product", PRODUCT_NAME,
                "tagline", TAGLINE,
                "revision", current.revision(),
                "diagramKinds", MetamodelRegistry.diagramCount(),
                "onlineSessions", broker.sessionCount(),
                "persistence", persistence.describe(),
                "undoDepth", current.undoDepth(sessionId),
                "redoDepth", current.redoDepth(sessionId));
    }

    public ModelSnapshot model() {
        return model("");
    }

    @GetMapping("/model")
    public ModelSnapshot model(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        return forProject(projectId).snapshot();
    }

    @GetMapping("/metamodel/diagrams")
    public List<Map<String, Object>> diagrams() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (DiagramKind kind : DiagramKind.values()) {
            MetamodelRegistry.DiagramSpec spec = MetamodelRegistry.spec(kind);
            result.add(Map.of(
                    "code", kind.code(),
                    "label", kind.label(),
                    "layout", spec.layout(),
                    "elementTypes", spec.elements().size(),
                    "allowedTypes", spec.elements().stream().map(ElementType::name).sorted().toList(),
                    "allowedRelationships", spec.relationships().stream()
                            .map(RelationshipType::code).sorted().toList(),
                    "validationGroup", spec.validationGroup()));
        }
        return result;
    }

    /** 关系类型目录：组件工具箱「关系」分组与新建关系弹窗共用，前端不硬编码类型清单。 */
    @GetMapping("/metamodel/relationships")
    public List<Map<String, Object>> relationships() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (RelationshipType type : RelationshipType.values()) {
            result.add(Map.of(
                    "code", type.code(),
                    "label", type.label(),
                    "stereotype", type.stereotype(),
                    "family", type.family()));
        }
        return result;
    }

    /** 元模型包含规则下发给前端：右键菜单只列出规范允许的父子组合。 */
    @GetMapping("/metamodel/containment")
    public Map<String, Object> containment() {
        List<Map<String, Object>> rules = new ArrayList<>();
        for (ElementType parent : ElementType.values()) {
            rules.add(Map.of(
                    "parent", parent.name(),
                    "parentLabel", parent.label(),
                    "children", ContainmentRules.childrenOf(parent).stream().map(this::typeInfo).toList()));
        }
        List<Map<String, Object>> types = new ArrayList<>();
        for (ElementType type : ElementType.values()) {
            types.add(typeInfo(type));
        }
        return Map.of(
                "rootTypes", ContainmentRules.ROOT_TYPES.stream().map(ElementType::name).toList(),
                "rules", rules,
                "types", types,
                "canvas", Map.of("maxX", ValidationEngine.CANVAS_MAX_X,
                        "maxY", ValidationEngine.CANVAS_MAX_Y,
                        "width", 640.0, "height", 420.0),
                "node", Map.of("width", ValidationEngine.NODE_WIDTH,
                        "height", ValidationEngine.NODE_HEIGHT));
    }

    private Map<String, Object> typeInfo(ElementType type) {
        return Map.of(
                "code", type.name(),
                "uml", type.umlName(),
                "label", type.label(),
                "stereotype", type.stereotype());
    }

    public Patch commands(CommandRequest request, String sessionId) {
        return commands(request, sessionId, "");
    }

    @PostMapping("/commands")
    public Patch commands(@RequestBody CommandRequest request,
                          @RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId,
                          @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        String clientCmdId = request.clientCmdId() == null || request.clientCmdId().isBlank()
                ? UUID.randomUUID().toString()
                : request.clientCmdId();
        Command command = new Command(request.type(), request.payload(), request.baseRevision(), clientCmdId);
        return forProject(projectId).execute(sessionId, command);
    }

    public Patch undo(String sessionId) {
        return undo(sessionId, "");
    }

    @PostMapping("/commands/undo")
    public Patch undo(@RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId,
                      @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        return forProject(projectId).undo(sessionId);
    }

    public Patch redo(String sessionId) {
        return redo(sessionId, "");
    }

    @PostMapping("/commands/redo")
    public Patch redo(@RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId,
                      @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        return forProject(projectId).redo(sessionId);
    }

    public Map<String, Object> exportModel() {
        return exportModel("");
    }

    @GetMapping("/export/scofen.json")
    public Map<String, Object> exportModel(
            @RequestHeader(value = "X-Scofen-Project", defaultValue = "") String projectId) {
        return Map.of(
                "format", "scofen.json",
                "version", "1.0",
                "lossless", Boolean.TRUE,
                "snapshot", forProject(projectId).snapshot());
    }
}
