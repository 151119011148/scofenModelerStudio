package com.scofen.model.core;

import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.NotationStyle;
import com.scofen.model.metamodel.Relationship;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 图形样式（节点 / 连线 / 图框）的服务端契约：白名单校验、批量写入、
 * 一步撤销、成员变更后样式不丢、快照与 XMI 侧车往返。
 */
class NotationStyleCommandTest {

    private static final String SESSION = "style-session";

    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), patch -> { });
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "part", "type", "PartProperty", "name", "主控", "ownerId", "blk"));
        cmd("CREATE_DIAGRAM", Map.of("id", "d-ibd", "kind", "ibd", "name", "内部块图",
                "elementIds", List.of("part")));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "rel", "type", "connector",
                "sourceId", "part", "targetId", "blk"));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION,
                Command.of(type, executor.revision(), "style-" + (++counter), payload));
    }

    private Notation notation(String id) {
        return executor.snapshot().notations().stream()
                .filter(n -> n.id().equals(id)).findFirst().orElseThrow();
    }

    private com.scofen.model.metamodel.Diagram diagram() {
        return executor.snapshot().diagrams().stream()
                .filter(d -> d.id().equals("d-ibd")).findFirst().orElseThrow();
    }

    private static Map<String, Object> item(String id, Map<String, Object> style) {
        return Map.of("notationId", id, "style", style);
    }

    @Test
    void createWithShapeStyleUsesOneUndoableCommand() {
        cmd("CREATE_DIAGRAM", Map.of("id", "d-bdd", "kind", "bdd", "name", "架构图"));
        long before = executor.revision();
        Map<String, Object> placement = Map.of(
                "id", "db", "type", "Node", "name", "数据库", "ownerId", "pkg",
                "diagramId", "d-bdd", "x", 210, "y", 370, "style", Map.of("shapeVariant", "database"));
        cmd("CREATE_ELEMENT", placement);
        String notation = "n-d-bdd-db";
        assertThat(executor.revision()).isEqualTo(before + 1);
        assertThat(notation(notation).style()).containsEntry("shapeVariant", "database");
        assertThat(notation(notation).x()).isEqualTo(210);
        executor.undo(SESSION);
        assertThat(executor.snapshot().notations()).noneMatch(n -> n.id().equals(notation));
        executor.redo(SESSION);
        assertThat(notation(notation).style()).containsEntry("shapeVariant", "database");
        cmd("SET_NOTATION_STYLE", Map.of("items", List.of(item(notation, Map.of("shapeVariant", "")))));
        assertThat(notation(notation).style()).doesNotContainKey("shapeVariant");
        executor.undo(SESSION);
        assertThat(notation(notation).style()).containsEntry("shapeVariant", "database");
    }

    @Test
    void notationStyleIsMergedWrittenAndUndoneInOneStep() {
        String id = notation("n-d-ibd-part").id();
        double beforeX = notation(id).x();
        long revision = executor.revision();

        cmd("SET_NOTATION_STYLE", Map.of("items", List.of(item(id, Map.of(
                "fontSize", "18", "fontColor", "#b23c3c", "fill", "#fff2cc", "strokeDash", "dashed")))));
        assertThat(executor.revision()).isEqualTo(revision + 1);
        assertThat(notation(id).style()).containsEntry("fontSize", "18")
                .containsEntry("fill", "#fff2cc").containsEntry("strokeDash", "dashed");
        // 样式命令绝不碰坐标与尺寸
        assertThat(notation(id).x()).isEqualTo(beforeX);

        // 增量再改一次：空串是删除标记
        cmd("SET_NOTATION_STYLE", Map.of("items", List.of(item(id, Map.of(
                "fontSize", "20", "fill", "")))));
        assertThat(notation(id).style()).containsEntry("fontSize", "20").doesNotContainKey("fill");

        executor.undo(SESSION);
        assertThat(notation(id).style()).containsEntry("fontSize", "18").containsEntry("fill", "#fff2cc");

        executor.undo(SESSION);
        assertThat(notation(id).style()).isEmpty();
    }

    @Test
    void diagramFrameStyleSurvivesMembershipAndNameChanges() {
        cmd("SET_DIAGRAM_STYLE", Map.of("diagramId", "d-ibd", "style", Map.of(
                "frame", "off", "frameBorder", "#123456", "frameTitle", "内部块图 · 控制器")));
        assertThat(diagram().style()).containsEntry("frame", "off")
                .containsEntry("frameBorder", "#123456");

        cmd("CREATE_ELEMENT", Map.of("id", "part2", "type", "PartProperty", "name", "备控", "ownerId", "blk"));
        cmd("ADD_TO_DIAGRAM", Map.of("diagramId", "d-ibd", "elementId", "part2"));
        assertThat(diagram().elementIds()).contains("part2");
        assertThat(diagram().style()).containsEntry("frame", "off");

        cmd("RENAME_DIAGRAM", Map.of("id", "d-ibd", "name", "控制器内部块图"));
        assertThat(diagram().style()).containsEntry("frame", "off");

        // replace=true 是撤销 / 重置通道：整包替换
        cmd("SET_DIAGRAM_STYLE", Map.of("diagramId", "d-ibd", "style", Map.of("frame", "on"),
                "replace", Boolean.TRUE));
        assertThat(diagram().style()).containsExactly(Map.entry("frame", "on"));

        executor.undo(SESSION);
        assertThat(diagram().style()).containsEntry("frame", "off")
                .containsEntry("frameTitle", "内部块图 · 控制器");
    }

    @Test
    void invalidStylesAreRejectedBeforeTheyTouchTheSnapshot() {
        String id = notation("n-d-ibd-part").id();
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of(
                item(id, Map.of("onclick", "alert(1)"))))))
                .isInstanceOf(ValidationException.class).hasMessageContaining("未知样式键");
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of(
                item(id, Map.of("fill", "url(javascript:alert(1))"))))))
                .isInstanceOf(ValidationException.class).hasMessageContaining("颜色");
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of(
                item(id, Map.of("fontSize", "999"))))))
                .isInstanceOf(ValidationException.class).hasMessageContaining("超出范围");
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of(
                item(id, Map.of("fontWeight", "heavy"))))))
                .isInstanceOf(ValidationException.class).hasMessageContaining("允许集合");
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of(
                item("n-missing", Map.of("fontSize", "16"))))))
                .isInstanceOf(ValidationException.class).hasMessageContaining("Unknown notation");
        assertThatThrownBy(() -> cmd("SET_NOTATION_STYLE", Map.of("items", List.of())))
                .isInstanceOf(ValidationException.class).hasMessageContaining("items");
        assertThat(notation(id).style()).isEmpty();
    }

    @Test
    void relationStyleUsesPerDiagramPresentationProperty() {
        Map<String, Object> style = Map.of("lineColor", "#c05621", "lineWidth", "2.5", "lineDash", "dashed");
        cmd("UPDATE_PROPERTY", Map.of("id", "rel", "key", "style:d-ibd", "value", style));
        Relationship relation = executor.snapshot().relationships().stream()
                .filter(r -> r.id().equals("rel")).findFirst().orElseThrow();
        assertThat(relation.properties()).containsKey("style:d-ibd");
        assertThat(NotationStyle.fromPropertyValue(relation.properties().get("style:d-ibd")))
                .containsEntry("lineColor", "#c05621").containsEntry("lineWidth", "2.5");

        assertThatThrownBy(() -> cmd("UPDATE_PROPERTY", Map.of("id", "rel", "key", "style:d-ibd",
                "value", Map.of("lineColor", "javascript:alert(1)"))))
                .isInstanceOf(ValidationException.class);

        executor.undo(SESSION);
        assertThat(executor.snapshot().relationships().stream()
                .filter(r -> r.id().equals("rel")).findFirst().orElseThrow().properties())
                .doesNotContainKey("style:d-ibd");
    }

    @Test
    void snapshotRoundTripKeepsDiagramAndNotationStyles() {
        String id = notation("n-d-ibd-part").id();
        cmd("SET_NOTATION_STYLE", Map.of("items", List.of(item(id, Map.of("fontSize", "17")))));
        cmd("SET_DIAGRAM_STYLE", Map.of("diagramId", "d-ibd", "style", Map.of(
                "frame", "on", "frameBorder", "#2b5cb8")));

        ModelSnapshot restored = SnapshotCodec.fromJson(SnapshotCodec.toJson(executor.snapshot()));
        assertThat(restored.notations().stream().filter(n -> n.id().equals(id))
                .findFirst().orElseThrow().style()).containsEntry("fontSize", "17");
        assertThat(restored.diagrams().stream().filter(d -> d.id().equals("d-ibd"))
                .findFirst().orElseThrow().style()).containsEntry("frameBorder", "#2b5cb8");
    }
}
