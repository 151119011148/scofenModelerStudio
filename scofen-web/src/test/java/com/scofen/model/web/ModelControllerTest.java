package com.scofen.model.web;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.NoopPersistenceService;
import com.scofen.model.core.Patch;
import com.scofen.model.core.RevisionConflictException;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.core.ValidationException;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.web.api.ApiExceptionHandler;
import com.scofen.model.web.api.CommandRequest;
import com.scofen.model.web.api.ModelController;
import com.scofen.model.web.persistence.NoopPersistenceServiceFactory;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ModelControllerTest {

    private CommandExecutor executor;
    private PatchBroker broker;
    private ModelController controller;

    @BeforeEach
    void setUp() {
        PatchWebSocketHandler handler = new PatchWebSocketHandler();
        broker = new PatchBroker(handler);
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker);
        controller = new ModelController(executor, broker, new NoopPersistenceServiceFactory());
    }

    private Patch post(String type, Map<String, Object> payload, long baseRevision, String cmdId) {
        return controller.commands(new CommandRequest(type, payload, baseRevision, cmdId), "session-1");
    }

    @Test
    void healthReportsBrandTaglineAndNineDiagrams() {
        Map<String, Object> health = controller.health("default");
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

        Map<String, Object> req = diagrams.stream()
                .filter(item -> "req".equals(item.get("code"))).findFirst().orElseThrow();
        assertThat(req.get("allowedRelationships"))
                .as("需求图只允许需求类关系")
                .isEqualTo(List.of("allocate", "containment", "copy", "deriveReqt",
                        "refine", "satisfy", "trace", "verify"));
        @SuppressWarnings("unchecked")
        List<String> reqRelationships = (List<String>) req.get("allowedRelationships");
        assertThat(reqRelationships).doesNotContain("connector", "message");
    }

    @Test
    void relationshipsEndpointPublishesServerSideCatalog() {
        List<Map<String, Object>> catalog = controller.relationships();
        assertThat(catalog).isNotEmpty();
        assertThat(catalog).extracting(item -> item.get("code"))
                .contains("satisfy", "verify", "containment", "allocate", "connector");
        assertThat(catalog).extracting(item -> item.get("label"))
                .contains("满足", "验证", "包含");
        assertThat(catalog).allSatisfy(item -> {
            assertThat(item.get("stereotype")).isNotNull();
            assertThat(item.get("family")).isNotNull();
            // 关系目录必须带上规范元类：界面据此显示归属，扩展包「关系」子包据此可定位。
            assertThat(item.get("metaclass")).isNotNull();
            assertThat(item.get("spec")).isNotNull();
            assertThat(item.get("stereotypeRelationship")).isInstanceOf(Boolean.class);
        });

        Map<String, Object> satisfy = catalog.stream()
                .filter(item -> "satisfy".equals(item.get("code"))).findFirst().orElseThrow();
        assertThat(satisfy.get("metaclass")).isEqualTo("DEPENDENCY");
        assertThat(satisfy.get("stereotypeRelationship")).isEqualTo(Boolean.TRUE);
    }

    @Test
    void extensionEndpointPublishesRelationshipPackages() {
        Map<String, Object> payload = controller.extension();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> packages = (List<Map<String, Object>>) payload.get("packages");
        assertThat(packages).extracting(item -> item.get("id")).contains(
                ExtensionLibrary.SYSML_PROFILE_ID + ExtensionLibrary.RELATIONSHIP_PACKAGE_SUFFIX,
                ExtensionLibrary.UML_PROFILE_ID + ExtensionLibrary.RELATIONSHIP_PACKAGE_SUFFIX);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> elements = (List<Map<String, Object>>) payload.get("elements");
        assertThat(elements).extracting(item -> item.get("id")).contains(
                ExtensionLibrary.relationshipId("satisfy"),
                ExtensionLibrary.relationshipId("association"));
        Map<String, Object> satisfy = elements.stream()
                .filter(item -> ExtensionLibrary.relationshipId("satisfy").equals(item.get("id")))
                .findFirst().orElseThrow();
        assertThat(satisfy.get("type")).isEqualTo("STEREOTYPE");
        assertThat(satisfy.get("stereotypes")).isEqualTo(List.of("stereotype"));
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

    /**
     * 载荷缺失要走校验失败（400），不能因为 {@code Map.copyOf(null)} 抛 NPE 变成 500。
     * 这是客户端能自查的错误，服务端不该报「内部错误」。
     */
    @Test
    void missingPayloadIsAValidationFailureNotAServerError() {
        assertThatThrownBy(() -> controller.commands(
                new CommandRequest("CREATE_ELEMENT", null, 0L, "c-null"), "session-1"))
                .isInstanceOf(ValidationException.class);
    }
}
