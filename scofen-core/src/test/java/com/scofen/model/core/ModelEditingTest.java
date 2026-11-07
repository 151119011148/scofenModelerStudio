package com.scofen.model.core;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.Notation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 模型树增删、包含规则、级联删除与记法拖拽的服务端契约。 */
class ModelEditingTest {

    private static final String SESSION = "editing-session";

    private final List<Patch> published = new ArrayList<>();
    private final PatchSink sink = published::add;
    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        published.clear();
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), sink);
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION,
                Command.of(type, executor.revision(), "edit-" + (++counter), payload));
    }

    private void seedTree() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "part", "type", "PartProperty", "name", "主控", "ownerId", "blk"));
        cmd("CREATE_ELEMENT", Map.of("id", "port", "type", "Port", "name", "CAN", "ownerId", "blk"));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "rel", "type", "connector", "sourceId", "part", "targetId", "port"));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-ibd", "kind", "ibd", "name", "内部块图",
                "elementIds", List.of("part", "port")));
    }

    private Notation notation(String diagramId, String elementId) {
        return executor.snapshot().notations().stream()
                .filter(n -> n.diagramId().equals(diagramId) && n.elementId().equals(elementId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("missing notation " + diagramId + "/" + elementId));
    }

    private Diagram diagram(String id) {
        return executor.snapshot().diagrams().stream()
                .filter(d -> d.id().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void dropCoordinatesAreWrittenByASingleCommand() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-pkg", "kind", "pkg", "name", "包图"));

        // 工具箱拖放：CREATE_ELEMENT 自带坐标，一条命令即生成指定位置的 Notation。
        cmd("CREATE_ELEMENT", Map.of("id", "drop-pkg", "type", "Package", "name", "拖入包",
                "ownerId", "pkg", "diagramId", "d-pkg", "x", 222.0, "y", 137.0));
        assertThat(notation("d-pkg", "drop-pkg").x()).isEqualTo(222.0);
        assertThat(notation("d-pkg", "drop-pkg").y()).isEqualTo(137.0);

        // 撤销一次即移除拖入的元素与其记法（不再需要撤销两次），重做后坐标仍保留。
        executor.undo(SESSION);
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id).doesNotContain("drop-pkg");
        assertThat(executor.snapshot().notations()).noneMatch(n -> n.elementId().equals("drop-pkg"));
        executor.redo(SESSION);
        assertThat(notation("d-pkg", "drop-pkg").x()).isEqualTo(222.0);

        // 模型树已有元素拖入：ADD_TO_DIAGRAM 自带坐标，同样单命令落位。
        cmd("ADD_TO_DIAGRAM", Map.of("diagramId", "d-pkg", "elementId", "pkg", "x", 12.0, "y", 34.0));
        assertThat(notation("d-pkg", "pkg").x()).isEqualTo(12.0);
        assertThat(notation("d-pkg", "pkg").y()).isEqualTo(34.0);
    }

    @Test
    void dropCoordinatesOutsideCanvasAreRejected() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-pkg", "kind", "pkg", "name", "包图"));
        assertThatThrownBy(() -> cmd("ADD_TO_DIAGRAM", Map.of(
                "diagramId", "d-pkg", "elementId", "pkg", "x", 999.0, "y", 34.0)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("out of canvas");
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT", Map.of(
                "id", "bad", "type", "Package", "name", "越界包", "ownerId", "pkg",
                "diagramId", "d-pkg", "x", 10.0, "y", -5.0)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("out of canvas");
    }

    @Test
    void relationshipTypeMustBeRegisteredAndAllowedOnDiagram() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-bdd", "kind", "bdd", "name", "模块定义图",
                "elementIds", List.of("blk")));

        assertThatThrownBy(() -> cmd("CREATE_RELATIONSHIP", Map.of(
                "id", "r-unknown", "type", "teleport", "sourceId", "pkg", "targetId", "blk",
                "diagramId", "d-bdd")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Unknown relationship type");
        assertThatThrownBy(() -> cmd("CREATE_RELATIONSHIP", Map.of(
                "id", "r-illegal", "type", "connector", "sourceId", "pkg", "targetId", "blk",
                "diagramId", "d-bdd")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("not allowed on");

        cmd("CREATE_RELATIONSHIP", Map.of(
                "id", "r-ok", "type", "generalization", "sourceId", "pkg", "targetId", "blk",
                "diagramId", "d-bdd"));
        assertThat(executor.snapshot().relationships()).hasSize(1);
    }

    @Test
    void containmentRulesRejectIllegalParentChildCombination() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "bad", "type", "Port", "name", "端口", "ownerId", "pkg")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Containment rule violation");

        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "good", "type", "Port", "name", "端口", "ownerId", "blk"));
        assertThat(executor.snapshot().elements()).extracting(ModelElement::ownerId).contains("blk");
    }

    @Test
    void rootElementMustBeATopLevelContainer() {
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Root element must be one of");
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        assertThat(executor.snapshot().elements()).hasSize(1);
    }

    @Test
    void packageProjectRootAllowsMultipleModelChildrenAndCannotBeDeleted() {
        cmd("CREATE_ELEMENT", Map.of("id", "model-root", "type", "Package", "name", "项目根", "ownerId", ""));
        // 把项目根改成 Package 的目的：Model 是 Package 的一种，根下可以组织多个模型节点。
        cmd("CREATE_ELEMENT", Map.of("id", "m-1", "type", "Model", "name", "系统模型", "ownerId", "model-root"));
        cmd("CREATE_ELEMENT", Map.of("id", "m-2", "type", "Model", "name", "需求模型", "ownerId", "model-root"));
        assertThat(executor.snapshot().elements()).filteredOn(e -> "Model".equals(e.type()))
                .extracting(ModelElement::id).containsExactly("m-1", "m-2");

        // 顶层 Model 一律拒绝：项目根固定是 Package，Model 只能作为子元素。
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "top-model", "type", "Model", "name", "顶层模型", "ownerId", "")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Model 必须建在项目根 Package 下");

        // 项目根（id 固定 model-root）不可删除，但根下的 Model 可以正常删除。
        assertThatThrownBy(() -> cmd("DELETE_ELEMENT", Map.of("id", "model-root")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("项目根节点不可删除");
        cmd("DELETE_ELEMENT", Map.of("id", "m-2"));
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id)
                .contains("model-root", "m-1").doesNotContain("m-2");
    }

    @Test
    void unknownTypeMissingOwnerAndBadNameAreRejected() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "x1", "type", "Widget", "name", "X", "ownerId", "pkg")))
                .isInstanceOf(ValidationException.class).hasMessageContaining("Unknown element type");
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "x2", "type", "Block", "name", "X", "ownerId", "missing")))
                .isInstanceOf(ValidationException.class).hasMessageContaining("Owner element not found");
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "x3", "type", "Block", "name", "坏\n名字", "ownerId", "pkg")))
                .isInstanceOf(ValidationException.class).hasMessageContaining("control characters");
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "x4", "type", "Block", "name", "X".repeat(121), "ownerId", "pkg")))
                .isInstanceOf(ValidationException.class).hasMessageContaining("too long");
        assertThat(executor.snapshot().elements()).hasSize(1);
    }

    @Test
    void createElementCanJoinDiagramAndReceivesDefaultNotation() {
        seedTree();
        Patch patch = cmd("CREATE_ELEMENT", Map.of(
                "id", "port2", "type", "Port", "name", "CAN2", "ownerId", "blk",
                "stereotypes", List.of("port"), "diagramId", "d-ibd"));

        assertThat(diagram("d-ibd").elementIds()).contains("port2");
        assertThat(notation("d-ibd", "port2").x()).isGreaterThanOrEqualTo(0);
        assertThat(patch.affectedIds()).contains("port2", "d-ibd");
        assertThat(patch.validationDelta()).isEqualTo("ok");

        assertThatThrownBy(() -> cmd("CREATE_ELEMENT", Map.of(
                "id", "req", "type", "Requirement", "name", "不该出现在 IBD", "ownerId", "pkg",
                "diagramId", "d-ibd")))
                .isInstanceOf(ValidationException.class).hasMessageContaining("not allowed on");
    }

    @Test
    void deleteCascadesSubtreeRelationshipsNotationsAndUndoRestoresEverything() {
        seedTree();
        double originalX = notation("d-ibd", "part").x();

        Patch patch = cmd("DELETE_ELEMENT", Map.of("id", "pkg"));
        assertThat(patch.affectedIds()).contains("pkg", "blk", "part", "port", "rel", "d-ibd");
        assertThat(executor.snapshot().elements()).isEmpty();
        assertThat(executor.snapshot().relationships()).isEmpty();
        assertThat(executor.snapshot().notations()).isEmpty();
        assertThat(diagram("d-ibd").elementIds()).isEmpty();
        assertThat(patch.validationDelta()).isEqualTo("ok");

        executor.undo(SESSION);
        assertThat(executor.snapshot().elements()).hasSize(4);
        assertThat(executor.snapshot().relationships()).hasSize(1);
        assertThat(executor.snapshot().notations()).hasSize(2);
        assertThat(diagram("d-ibd").elementIds()).containsExactly("part", "port");
        assertThat(notation("d-ibd", "part").x()).isEqualTo(originalX);
    }

    @Test
    void moveNotationPersistsCoordinatesIsValidatedAndIsUndoable() {
        seedTree();
        double originalX = notation("d-ibd", "part").x();
        double originalY = notation("d-ibd", "part").y();

        Patch patch = cmd("MOVE_NOTATION", Map.of(
                "diagramId", "d-ibd", "elementId", "part", "x", 120.0, "y", 96.0));
        assertThat(notation("d-ibd", "part").x()).isEqualTo(120.0);
        assertThat(notation("d-ibd", "part").y()).isEqualTo(96.0);
        assertThat(patch.affectedIds()).contains("d-ibd", "part");
        assertThat(patch.validationDelta()).isEqualTo("ok");

        assertThatThrownBy(() -> cmd("MOVE_NOTATION", Map.of(
                "diagramId", "d-ibd", "elementId", "part", "x", 9999.0, "y", 10.0)))
                .isInstanceOf(ValidationException.class).hasMessageContaining("out of canvas");
        assertThatThrownBy(() -> cmd("MOVE_NOTATION", Map.of(
                "diagramId", "d-ibd", "elementId", "blk", "x", 10.0, "y", 10.0)))
                .isInstanceOf(ValidationException.class).hasMessageContaining("is not on diagram");

        executor.undo(SESSION);
        assertThat(notation("d-ibd", "part").x()).isEqualTo(originalX);
        assertThat(notation("d-ibd", "part").y()).isEqualTo(originalY);
    }

    @Test
    void moveNotationUpsertsMissingNotationAndItsInverseRemovesIt() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-bdd", "kind", "bdd", "name", "块定义图",
                "elementIds", List.of("blk")));
        cmd("DELETE_NOTATION", Map.of("id", "n-d-bdd-blk"));

        Patch patch = cmd("MOVE_NOTATION", Map.of(
                "diagramId", "d-bdd", "elementId", "blk", "x", 200.0, "y", 140.0));
        assertThat(notation("d-bdd", "blk").x()).isEqualTo(200.0);
        assertThat(patch.inverse().type()).isEqualTo("DELETE_NOTATION");

        executor.undo(SESSION);
        assertThat(executor.snapshot().notations()).isEmpty();
    }
}
