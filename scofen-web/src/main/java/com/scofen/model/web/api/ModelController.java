package com.scofen.model.web.api;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.Patch;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.ContainmentRules;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.ws.PatchBroker;
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

    public ModelController(CommandExecutor executor, PatchBroker broker) {
        this.executor = executor;
        this.broker = broker;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "UP",
                "product", PRODUCT_NAME,
                "tagline", TAGLINE,
                "revision", executor.revision(),
                "diagramKinds", MetamodelRegistry.diagramCount(),
                "onlineSessions", broker.sessionCount(),
                "persistence", "in-memory (M0 skeleton)");
    }

    @GetMapping("/model")
    public ModelSnapshot model() {
        return executor.snapshot();
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
                    "validationGroup", spec.validationGroup()));
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

    @PostMapping("/commands")
    public Patch commands(@RequestBody CommandRequest request,
                          @RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId) {
        String clientCmdId = request.clientCmdId() == null || request.clientCmdId().isBlank()
                ? UUID.randomUUID().toString()
                : request.clientCmdId();
        Command command = new Command(request.type(), request.payload(), request.baseRevision(), clientCmdId);
        return executor.execute(sessionId, command);
    }

    @PostMapping("/commands/undo")
    public Patch undo(@RequestHeader(value = "X-Scofen-Session", defaultValue = "default") String sessionId) {
        return executor.undo(sessionId);
    }

    @GetMapping("/export/scofen.json")
    public Map<String, Object> exportModel() {
        return Map.of(
                "format", "scofen.json",
                "version", "1.0",
                "lossless", Boolean.TRUE,
                "snapshot", executor.snapshot());
    }
}
