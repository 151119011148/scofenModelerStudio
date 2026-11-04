package com.scofen.model.core;

import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CommandExecutorTest {

    private static final String SESSION = "test-session";

    private final List<Patch> published = new ArrayList<>();
    private final PatchSink sink = published::add;
    private CommandExecutor executor;
    private int cmdCounter;

    @BeforeEach
    void setUp() {
        published.clear();
        cmdCounter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), sink);
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION,
                Command.of(type, executor.revision(), "cmd-" + (++cmdCounter), payload));
    }

    private void seed() {
        cmd("CREATE_ELEMENT", Map.of("id", "pkg-1", "type", "Package", "name", "车载动力系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "e-1", "type", "Block", "name", "动力控制器", "ownerId", "pkg-1"));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-bdd", "kind", "bdd", "name", "系统结构", "elementIds", List.of("e-1")));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-bdd-2", "kind", "bdd", "name", "结构副本", "elementIds", List.of("e-1")));
    }

    @Test
    void renameUpdatesSingleSourceOfTruthAcrossEveryDiagram() {
        seed();
        Patch patch = cmd("RENAME_ELEMENT", Map.of("id", "e-1", "name", "整车控制器"));

        assertThat(patch.revision()).isEqualTo(5L);
        assertThat(patch.affectedIds()).contains("e-1", "d-bdd", "d-bdd-2");
        assertThat(executor.snapshot().elements().stream()
                .filter(e -> e.id().equals("e-1")).findFirst().orElseThrow().name())
                .isEqualTo("整车控制器");
        // 图只持有 id 引用；任一视图解析语义层都读到新名字
        assertThat(executor.snapshot().diagrams()).hasSize(2)
                .allSatisfy(d -> assertThat(d.elementIds()).contains("e-1"));
        assertThat(patch.validationDelta()).isEqualTo("ok");
    }

    @Test
    void staleBaseRevisionIsRejectedWithConflict() {
        seed();
        Command stale = Command.of("RENAME_ELEMENT", 0L, "stale-1", Map.of("id", "e-1", "name", "过期写入"));
        assertThatThrownBy(() -> executor.execute(SESSION, stale))
                .isInstanceOf(RevisionConflictException.class)
                .satisfies(ex -> {
                    RevisionConflictException conflict = (RevisionConflictException) ex;
                    assertThat(conflict.expected()).isEqualTo(0L);
                    assertThat(conflict.actual()).isEqualTo(4L);
                });
        assertThat(executor.revision()).isEqualTo(4L);
    }

    @Test
    void duplicateClientCmdIdIsIdempotent() {
        Command create = Command.of("CREATE_ELEMENT", 0L, "same-id",
                Map.of("id", "e-1", "type", "Block", "name", "A", "ownerId", ""));
        Patch first = executor.execute(SESSION, create);
        Patch second = executor.execute(SESSION, create);

        assertThat(second).isEqualTo(first);
        assertThat(executor.revision()).isEqualTo(1L);
        assertThat(published).hasSize(1);
    }

    @Test
    void undoRestoresPreviousNameUsingServerSideStack() {
        seed();
        cmd("RENAME_ELEMENT", Map.of("id", "e-1", "name", "整车控制器"));
        assertThat(executor.undoDepth(SESSION)).isEqualTo(5);

        Patch undone = executor.undo(SESSION);
        assertThat(undone.revision()).isEqualTo(6L);
        assertThat(executor.snapshot().elements().stream()
                .filter(e -> e.id().equals("e-1")).findFirst().orElseThrow().name())
                .isEqualTo("动力控制器");
    }

    @Test
    void namingUniquenessIsCaseInsensitiveLikeMysqlDefaultCollation() {
        cmd("CREATE_ELEMENT", Map.of("id", "e-1", "type", "Block", "name", "Controller", "ownerId", "pkg-1"));
        assertThatThrownBy(() -> cmd("CREATE_ELEMENT",
                Map.of("id", "e-2", "type", "Block", "name", "controller", "ownerId", "pkg-1")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Duplicate element name");
    }

    @Test
    void relationshipEndpointsMustExist() {
        cmd("CREATE_ELEMENT", Map.of("id", "e-1", "type", "Block", "name", "A", "ownerId", ""));
        assertThatThrownBy(() -> cmd("CREATE_RELATIONSHIP",
                Map.of("id", "r-1", "type", "trace", "sourceId", "e-1", "targetId", "missing")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("endpoints must exist");
    }

    @Test
    void generalizationCycleIsRejected() {
        cmd("CREATE_ELEMENT", Map.of("id", "e-a", "type", "Block", "name", "A", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "e-b", "type", "Block", "name", "B", "ownerId", ""));
        cmd("CREATE_RELATIONSHIP",
                Map.of("id", "r-1", "type", "generalization", "sourceId", "e-a", "targetId", "e-b"));
        assertThatThrownBy(() -> cmd("CREATE_RELATIONSHIP",
                Map.of("id", "r-2", "type", "generalization", "sourceId", "e-b", "targetId", "e-a")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("cycle");
    }

    @Test
    void deleteCleansAllDiagramReferences() {
        seed();
        Patch patch = cmd("DELETE_ELEMENT", Map.of("id", "e-1"));
        assertThat(patch.affectedIds()).contains("e-1", "d-bdd", "d-bdd-2");
        assertThat(executor.snapshot().diagrams()).allSatisfy(d -> assertThat(d.elementIds()).doesNotContain("e-1"));
        assertThat(patch.validationDelta()).isEqualTo("ok");

        executor.undo(SESSION);
        assertThat(executor.snapshot().elements().stream().anyMatch(e -> e.id().equals("e-1"))).isTrue();
    }

    @Test
    void everyCommandProducesExactlyOneBroadcastPatch() {
        seed();
        assertThat(published).hasSize(4);
        assertThat(published.get(0).seq()).isEqualTo(1L);
        assertThat(published.get(3).revision()).isEqualTo(4L);
        assertThat(published).allSatisfy(p -> {
            assertThat(p.affectedIds()).isNotEmpty();
            assertThat(p.changes()).isNotEmpty();
            assertThat(p.inverse()).isNotNull();
        });
        ModelSnapshot snapshot = executor.snapshot();
        assertThat(snapshot.elements()).extracting(ModelElement::id).containsExactlyInAnyOrder("pkg-1", "e-1");
    }
}
