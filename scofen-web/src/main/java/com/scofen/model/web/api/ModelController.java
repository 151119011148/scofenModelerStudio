package com.scofen.model.web.api;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.Patch;
import com.scofen.model.metamodel.DiagramKind;
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
                    "validationGroup", spec.validationGroup()));
        }
        return result;
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
