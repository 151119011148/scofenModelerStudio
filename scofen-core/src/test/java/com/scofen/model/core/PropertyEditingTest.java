package com.scofen.model.core;

import com.scofen.model.metamodel.ModelElement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 属性面板的通用写入契约：可编辑属性走 UPDATE_PROPERTY，派生/计算属性与未知属性一律拒绝。 */
class PropertyEditingTest {

    private static final String SESSION = "property-session";

    private final List<Patch> published = new ArrayList<>();
    private final PatchSink sink = published::add;
    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        published.clear();
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), sink);
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "blk", "type", "Block", "name", "制动控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "blk2", "type", "Block", "name", "转向控制器", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "part", "type", "PartProperty", "name", "执行器", "ownerId", "blk"));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION, Command.of(type, executor.revision(), "prop-" + (++counter), payload));
    }

    private ModelElement element(String id) {
        return executor.snapshot().elements().stream()
                .filter(e -> e.id().equals(id)).findFirst().orElseThrow();
    }

    private Object property(String id, String key) {
        return element(id).property(key);
    }

    @Test
    void booleanAndEnumPropertiesAreEditable() {
        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "isEncapsulated", "value", true));
        assertThat(property("blk", "isEncapsulated")).isEqualTo(true);

        cmd("UPDATE_PROPERTY", Map.of("id", "part", "key", "aggregation", "value", "composite"));
        assertThat(property("part", "aggregation")).isEqualTo("composite");
    }

    @Test
    void documentationAndListsRoundTrip() {
        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "documentation", "value", "负责制动力分配"));
        assertThat(element("blk").documentation()).isEqualTo("负责制动力分配");

        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "isAbstract", "value", true));
        assertThat(property("blk", "isAbstract")).isEqualTo(true);

        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "ownedAttribute", "value", List.of("part")));
        assertThat(property("blk", "ownedAttribute")).isEqualTo(List.of("part"));
    }

    @Test
    void undoRestoresPreviousValueIncludingRemoval() {
        Patch patch = cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "visibility", "value", "private"));
        assertThat(property("blk", "visibility")).isEqualTo("private");

        executor.undo(SESSION);
        assertThat(property("blk", "visibility")).isNull();

        executor.redo(SESSION);
        assertThat(property("blk", "visibility")).isEqualTo("private");
        assertThat(patch.revision()).isGreaterThan(0);
    }

    @Test
    void renamingThroughPropertyKeepsNameRules() {
        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "name", "value", "车身控制器"));
        assertThat(element("blk").name()).isEqualTo("车身控制器");

        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk2", "key", "name", "value", "车身控制器")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Duplicate element name");
    }

    @Test
    void derivedAndComputedPropertiesAreRejected() {
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "qualifiedName", "value", "x")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("计算属性");
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "descendantCount", "value", 3)))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("计算属性");
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "id", "value", "other")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("计算属性");
    }

    @Test
    void unknownOrForeignPropertyIsRejected() {
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "messageSort", "value", "synchCall")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("UML/SysML 规范清单");
    }

    @Test
    void valueKindIsEnforced() {
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "isAbstract", "value", "yes")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("true/false");
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "part", "key", "aggregation", "value", "bogus")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Invalid enumeration");
    }

    @Test
    void clearedPropertyStillAppearsInSnapshotAsAbsent() {
        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "isLeaf", "value", true));
        assertThat(property("blk", "isLeaf")).isEqualTo(true);

        cmd("UPDATE_PROPERTY", Map.of("id", "blk", "key", "isLeaf", "remove", true));
        assertThat(property("blk", "isLeaf")).isNull();
    }
}
