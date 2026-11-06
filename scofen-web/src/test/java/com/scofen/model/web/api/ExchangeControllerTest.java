package com.scofen.model.web.api;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.ExtensionSeeder;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * XMI 交换接口。
 *
 * <p>导入语义是「整包替换当前项目」：导入自己导出的文件，结果必须与导出前完全一致；
 * 撤销一次即回到导入前；通用扩展包永远保留（它是每个项目自带的系统公共内容）。</p>
 */
class ExchangeControllerTest {

    private CommandExecutor executor;
    private ExchangeController controller;

    @BeforeEach
    void setUp() {
        PatchBroker broker = new PatchBroker(new PatchWebSocketHandler());
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), broker);
        controller = new ExchangeController(executor);

        // 播种一个最小项目：项目根 + 通用扩展包 + 一个包 + 一个块 + 一张图。
        run("CREATE_ELEMENT", Map.of("id", "model-root", "type", "Model", "name", "示例项目",
                "ownerId", "", "stereotypes", List.of("model")));
        ExtensionSeeder.seed(executor, "model-root");
        run("CREATE_ELEMENT", Map.of("id", "pkg-1", "type", "Package", "name", "动力系统",
                "ownerId", "model-root", "stereotypes", List.of("package")));
        run("CREATE_ELEMENT", Map.of("id", "e-vcu", "type", "Block", "name", "整车控制器",
                "ownerId", "pkg-1", "stereotypes", List.of("block")));
        run("CREATE_DIAGRAM", Map.of("id", "d-bdd", "kind", "bdd", "name", "块定义图",
                "ownerId", "pkg-1", "elementIds", List.of("e-vcu")));
    }

    private void run(String type, Map<String, Object> payload) {
        run(type, payload, "system");
    }

    private void run(String type, Map<String, Object> payload, String sessionId) {
        // clientCmdId 是幂等键：必须逐条唯一，否则第二条命令会被幂等缓存直接返回，
        // 元素根本没建出来。
        executor.execute(sessionId, Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }

    private ResponseEntity<String> exportXmi() {
        return controller.exportXmi("");
    }

    private ResponseEntity<String> exportSidecar() {
        return controller.exportSidecar("");
    }

    @Test
    void exportXmiReturnsStandardUmlDocument() {
        ResponseEntity<String> response = exportXmi();
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("xmi:XMI").contains("uml:Model").contains("scofen:type=\"Block\"");
        assertThat(response.getHeaders().getFirst("Content-Disposition")).contains("model.xmi");
    }

    @Test
    void exportSidecarCarriesDiagramsAndNotations() {
        ResponseEntity<String> response = exportSidecar();
        assertThat(response.getBody()).contains("\"diagrams\"").contains("\"notations\"")
                .contains("d-bdd").contains("e-vcu");
    }

    @Test
    void exportNativeKeepsWholeSnapshot() {
        ResponseEntity<String> response = controller.exportNative("");
        assertThat(response.getBody()).contains("\"elements\"").contains("\"diagrams\"")
                .contains("整车控制器");
    }

    @Test
    void sidecarPreviewReportsDiagramAndNotationCounts() {
        Map<String, Object> preview = controller.sidecarPreview("");
        // CREATE_DIAGRAM 会为 elementIds 里的元素自动生成记号，因此记号数是 1。
        assertThat(preview).containsEntry("diagramCount", 1)
                .containsEntry("notationCount", 1)
                .containsEntry("expectedKinds", DiagramKind.values().length);
    }

    @Test
    void importingOwnExportKeepsEverythingAndIsIdempotent() {
        String semantic = exportXmi().getBody();
        String sidecar = exportSidecar().getBody();
        ModelSnapshot before = executor.snapshot();

        controller.importXmi(new ExchangeController.ImportRequest(semantic, sidecar), "s1", "");

        ModelSnapshot after = executor.snapshot();
        // 元素：导入内容 + 保留下来的扩展包
        assertThat(after.elements()).extracting(ModelElement::id)
                .contains("model-root", "pkg-1", "e-vcu")
                .contains(ExtensionLibrary.SYSML_PROFILE_ID, ExtensionLibrary.UML_PROFILE_ID);
        assertThat(after.elements()).hasSize(before.elements().size());
        assertThat(after.diagrams()).extracting(diagram -> diagram.id()).contains("d-bdd");
        assertThat(after.relationships()).isEmpty();

        // 再导一次再导回来，结果仍然一致（幂等）。
        String again = exportXmi().getBody();
        controller.importXmi(new ExchangeController.ImportRequest(again, exportSidecar().getBody()), "s1", "");
        assertThat(executor.snapshot().elements()).hasSize(before.elements().size());
        assertThat(executor.snapshot().diagrams()).hasSize(before.diagrams().size());
    }

    @Test
    void importReplacesOldContentInsteadOfMerging() {
        // 先导出「干净的」模型，再造一个导出文件里没有的元素。
        String semantic = exportXmi().getBody();
        String sidecar = exportSidecar().getBody();
        run("CREATE_ELEMENT", Map.of("id", "e-legacy", "type", "Block", "name", "旧模型遗留",
                "ownerId", "pkg-1", "stereotypes", List.of("block")));
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id).contains("e-legacy");

        controller.importXmi(new ExchangeController.ImportRequest(semantic, sidecar), "s1", "");

        assertThat(executor.snapshot().elements()).extracting(ModelElement::id).doesNotContain("e-legacy");
    }

    @Test
    void undoAfterImportRestoresPreviousContentAndRedoReimports() {
        ModelSnapshot before = executor.snapshot();
        List<String> beforeIds = before.elements().stream().map(ModelElement::id).toList();

        controller.importXmi(new ExchangeController.ImportRequest(
                exportXmi().getBody(), exportSidecar().getBody()), "s1", "");

        // 撤销：回到导入前的完整内容。
        executor.undo("s1");
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id)
                .containsExactlyInAnyOrderElementsOf(beforeIds);
        assertThat(executor.snapshot().diagrams()).extracting(diagram -> diagram.id())
                .containsExactlyInAnyOrderElementsOf(
                        before.diagrams().stream().map(com.scofen.model.metamodel.Diagram::id).toList());

        // 重做：重新导入。
        executor.redo("s1");
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id)
                .contains("model-root", "pkg-1", "e-vcu");
    }

    @Test
    void extensionLibrarySurvivesImportAndIsNotDuplicated() {
        long metaclassBefore = executor.snapshot().elements().stream()
                .filter(element -> element.id().startsWith(ExtensionLibrary.METACLASS_ID_PREFIX))
                .count();

        controller.importXmi(new ExchangeController.ImportRequest(
                exportXmi().getBody(), exportSidecar().getBody()), "s1", "");

        assertThat(executor.snapshot().elements())
                .filteredOn(element -> element.id().equals(ExtensionLibrary.SYSML_PROFILE_ID))
                .hasSize(1);
        assertThat(executor.snapshot().elements().stream()
                .filter(element -> element.id().startsWith(ExtensionLibrary.METACLASS_ID_PREFIX))
                .count()).isEqualTo(metaclassBefore);
    }

    @Test
    void importWithoutSidecarFallsBackToServerRelayoutOfNineDiagrams() {
        controller.importXmi(new ExchangeController.ImportRequest(exportXmi().getBody(), null), "s1", "");

        ModelSnapshot after = executor.snapshot();
        assertThat(after.diagrams()).hasSize(DiagramKind.values().length);
        assertThat(after.diagrams()).extracting(diagram -> diagram.kind().code())
                .containsExactlyInAnyOrder("pkg", "req", "bdd", "ibd", "par", "act", "seq", "stm", "uc");
        // 块按主图归属落到块定义图上。
        assertThat(after.diagrams().stream()
                .filter(diagram -> diagram.kind() == DiagramKind.BDD)
                .findFirst().orElseThrow().elementIds()).contains("e-vcu");
        assertThat(after.notations()).isNotEmpty();
    }

    @Test
    void importWithBrokenXmlIsRejected() {
        assertThatThrownBy(() -> controller.importXmi(
                new ExchangeController.ImportRequest("<xmi:XMI><unclosed>", null), "s1", ""))
                .isInstanceOf(RuntimeException.class);
        // 失败后模型原样不动。
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id).contains("e-vcu");
    }

    @Test
    void importWithoutSemanticContentIsRejected() {
        assertThatThrownBy(() -> controller.importXmi(
                new ExchangeController.ImportRequest("  ", null), "s1", ""))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void importNormalizesForeignRootIdToLocalRoot() {
        // 造一个根 id 不同的 XMI：导入后根 id 应归一到本地 project-root。
        String foreign = """
                <?xml version="1.0" encoding="UTF-8"?>
                <xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
                         xmlns:uml="http://www.omg.org/spec/UML/20131001"
                         xmlns:scofen="http://scofen.modeler/studio/1.0">
                  <uml:Model xmi:id="foreign-root" name="外来模型" scofen:type="Model">
                    <uml:ownedElement xmi:type="uml:Package" xmi:id="pkg-x" name="外来包"
                                     scofen:type="Package" scofen:ownerId="foreign-root"/>
                  </uml:Model>
                </xmi:XMI>
                """;
        controller.importXmi(new ExchangeController.ImportRequest(foreign, null), "s1", "");

        assertThat(executor.snapshot().elements()).extracting(ModelElement::id)
                .contains("model-root", "pkg-x");
        // 本地扩展包仍挂在本地根下，没有变成孤儿。
        ModelElement sysml = executor.snapshot().elements().stream()
                .filter(element -> element.id().equals(ExtensionLibrary.SYSML_PROFILE_ID))
                .findFirst().orElseThrow();
        assertThat(sysml.ownerId()).isEqualTo("model-root");
    }
}
