package com.scofen.model.core;

import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.metamodel.Relationship;
import com.scofen.model.metamodel.RelationshipType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 关系也是模型对象：关系属性必须与元素属性同构——
 * 可编辑项走 UPDATE_PROPERTY 并可撤销，端点与派生项只读，未知属性拒绝。
 */
class RelationshipPropertyEditingTest {

    private static final String SESSION = "relation-property-session";

    private final List<Patch> published = new ArrayList<>();
    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        published.clear();
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), published::add);
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "req1", "type", "Requirement", "name", "制动距离要求", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "blk1", "type", "Block", "name", "制动控制器", "ownerId", "pkg"));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "rel1", "type", "satisfy",
                "sourceId", "blk1", "targetId", "req1"));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION, Command.of(type, executor.revision(), "relprop-" + (++counter), payload));
    }

    private Relationship relationship(String id) {
        return executor.snapshot().relationships().stream()
                .filter(r -> r.id().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void relationCarriesNameDocumentationAndProperties() {
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "name", "value", "满足制动距离要求"));
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "documentation", "value", "由制动控制器满足"));
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "visibility", "value", "private"));
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "supplier", "value", List.of("req1")));

        Relationship relation = relationship("rel1");
        assertThat(relation.name()).isEqualTo("满足制动距离要求");
        assertThat(relation.documentation()).isEqualTo("由制动控制器满足");
        assertThat(relation.property("visibility")).isEqualTo("private");
        assertThat(relation.property("supplier")).isEqualTo(List.of("req1"));
    }

    @Test
    void relationPropertyIsUndoable() {
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "name", "value", "临时名称"));
        assertThat(relationship("rel1").name()).isEqualTo("临时名称");

        executor.undo(SESSION);
        assertThat(relationship("rel1").name()).isEqualTo("");

        executor.redo(SESSION);
        assertThat(relationship("rel1").name()).isEqualTo("临时名称");
    }

    @Test
    void endpointsAndDerivedPropertiesAreReadOnly() {
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "source", "value", List.of("req1"))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("不可修改");

        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "sourceId", "value", "req1")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("不可修改");
    }

    @Test
    void unknownPropertyIsRejected() {
        assertThatThrownBy(() ->
                cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "notARealProperty", "value", "x")))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("规范清单");
    }

    @Test
    void relationCatalogExposesStandardExpertAndAllLevels() {
        List<PropertyCatalog.PropertySpec> all = PropertyCatalog.forRelationship(RelationshipType.SATISFY);
        assertThat(all).isNotEmpty();
        assertThat(all).anyMatch(spec -> spec.key().equals("name") && spec.editable());
        assertThat(all).anyMatch(spec -> spec.key().equals("documentation") && spec.editable());
        assertThat(all).anyMatch(spec -> spec.key().equals("sourceId") && !spec.editable());
        assertThat(PropertyCatalog.filter(RelationshipType.SATISFY, PropertyCatalog.View.STANDARD))
                .isNotEmpty()
                .allMatch(spec -> spec.level() == PropertyCatalog.Level.STANDARD);
        assertThat(PropertyCatalog.filter(RelationshipType.SATISFY, PropertyCatalog.View.ALL).size())
                .isGreaterThanOrEqualTo(PropertyCatalog.filter(RelationshipType.SATISFY,
                        PropertyCatalog.View.EXPERT).size());
    }

    @Test
    void deleteAndRestoreKeepsRelationProperties() {
        cmd("UPDATE_PROPERTY", Map.of("id", "rel1", "key", "name", "value", "保留名称"));
        cmd("DELETE_RELATIONSHIP", Map.of("id", "rel1"));
        executor.undo(SESSION);
        assertThat(relationship("rel1").name()).isEqualTo("保留名称");
    }
}
