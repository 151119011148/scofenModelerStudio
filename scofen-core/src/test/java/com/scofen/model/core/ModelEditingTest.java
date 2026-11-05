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
    void projectRootModelIsUniqueAndCannotBeDeleted() {
        cmd("CREATE_ELEMENT", Map.of("id", "root", "type", "Model", "name", "项目模型", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", "root"));

        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "root2", "type", "Model", "name", "第二个根", "ownerId", "")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("一个项目只能有一个根 Model");
        assertThatThrownBy(() -> cmd("DELETE_ELEMENT", Map.of("id", "root")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("项目根节点模型不可删除");

        cmd("DELETE_ELEMENT", Map.of("id", "pkg"));
        assertThat(executor.snapshot().elements()).extracting(ModelElement::id).containsExactly("root");
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
