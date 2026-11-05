package com.scofen.model.web;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.Patch;
import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.web.api.ApiExceptionHandler;
import com.scofen.model.web.api.CommandRequest;
import com.scofen.model.web.api.ModelController;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ModelControllerTest {

    private CommandExecutor executor;
    private PatchBroker broker;
    private ModelController controller;

    @BeforeEach
    void setUp() {
        PatchWebSocketHandler handler = new PatchWebSocketHandler();
        broker = new PatchBroker(handler);
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker);
        controller = new ModelController(executor, broker);
    }

    private Patch post(String type, Map<String, Object> payload, long baseRevision, String cmdId) {
        return controller.commands(new CommandRequest(type, payload, baseRevision, cmdId), "session-1");
    }

    @Test
    void healthReportsBrandTaglineAndNineDiagrams() {
        Map<String, Object> health = controller.health();
        assertThat(health).containsEntry("status", "UP")
                .containsEntry("product", "Scofen Modeler Studio")
                .containsEntry("tagline", "One model. Nine views.")
                .containsEntry("diagramKinds", 9)
                .containsEntry("revision", 0L);
    }

    @Test
    void commandEndpointAppliesWriteAndBroadcastsExactlyOnePatch() {
        Patch patch = post("CREATE_ELEMENT",
                Map.of("id", "e-1", "type", "Package", "name", "控制器包", "ownerId", ""),
                0L, "c-1");

        assertThat(patch.revision()).isEqualTo(1L);
        assertThat(patch.affectedIds()).containsExactly("e-1");
        assertThat(broker.publishedCount()).isEqualTo(1);
        assertThat(broker.since(0L)).hasSize(1);
        assertThat(controller.model().elements()).hasSize(1);
    }

    @Test
    void staleRevisionIsMappedToHttp409() {
        var response = new ApiExceptionHandler().conflict(new RevisionConflictException(0L, 3L));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).containsEntry("error", "revision_conflict")
                .containsEntry("clientRevision", 0L)
                .containsEntry("serverRevision", 3L);
    }

    @Test
    void validationFailureIsMappedToHttp400() {
        var response = new ApiExceptionHandler().invalid(new ValidationException("bad name"));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("error", "validation_failed");
    }

    @Test
    void diagramsEndpointListsNineSpecsWithDedicatedSequenceLayout() {
        List<Map<String, Object>> diagrams = controller.diagrams();
        assertThat(diagrams).hasSize(9);
        assertThat(diagrams).extracting(item -> item.get("layout"))
                .contains(MetamodelRegistry.LAYOUT_SEQUENCE);
        assertThat(diagrams).extracting(item -> item.get("code"))
                .containsExactlyInAnyOrder("pkg", "req", "bdd", "ibd", "par", "act", "seq", "stm", "uc");
    }

    @Test
    void exportUsesLosslessScofenJsonFormat() {
        Map<String, Object> export = controller.exportModel();
        assertThat(export).containsEntry("format", "scofen.json")
                .containsEntry("version", "1.0")
                .containsEntry("lossless", Boolean.TRUE);
    }

    @Test
    void undoEndpointRestoresPreviousName() {
        post("CREATE_ELEMENT", Map.of("id", "e-1", "type", "Package", "name", "A", "ownerId", ""), 0L, "c-1");
        post("RENAME_ELEMENT", Map.of("id", "e-1", "name", "B"), 1L, "c-2");
        Patch undone = controller.undo("session-1");

        assertThat(undone.revision()).isEqualTo(3L);
        assertThat(controller.model().elements().get(0).name()).isEqualTo("A");
    }
}
