package com.scofen.model.metamodel;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MetamodelRegistryTest {

    @Test
    void nineSysmlDiagramsAreAllRegistered() {
        assertThat(MetamodelRegistry.diagramCount()).isEqualTo(9);
        assertThat(MetamodelRegistry.diagrams()).containsExactlyInAnyOrder(DiagramKind.values());
        assertThat(DiagramKind.fromCode("seq")).isEqualTo(DiagramKind.SEQ);
        assertThatThrownBy(() -> DiagramKind.fromCode("bpmn"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void everyDiagramHasElementsRelationshipsAndValidationGroup() {
        for (DiagramKind kind : DiagramKind.values()) {
            MetamodelRegistry.DiagramSpec spec = MetamodelRegistry.spec(kind);
            assertThat(spec.elements()).as("%s elements", kind).isNotEmpty();
            assertThat(spec.relationships()).as("%s relationships", kind).isNotEmpty();
            assertThat(spec.validationGroup()).as("%s validation group", kind).isNotBlank();
        }
        assertThat(MetamodelRegistry.validationGroups()).hasSize(9);
    }

    @Test
    void relationshipCatalogIsTableDrivenPerDiagram() {
        assertThat(MetamodelRegistry.spec(DiagramKind.REQ).relationships())
                .contains(RelationshipType.SATISFY, RelationshipType.VERIFY, RelationshipType.ALLOCATE)
                .doesNotContain(RelationshipType.CONNECTOR, RelationshipType.MESSAGE);
        assertThat(MetamodelRegistry.allowsRelationship(DiagramKind.IBD, RelationshipType.CONNECTOR)).isTrue();
        assertThat(MetamodelRegistry.allowsRelationship(DiagramKind.REQ, RelationshipType.CONNECTOR)).isFalse();
        assertThat(RelationshipType.fromAny("derive_reqt")).contains(RelationshipType.DERIVE_REQT);
        assertThat(RelationshipType.fromAny("unknown")).isEmpty();
    }

    @Test
    void sequenceDiagramUsesDedicatedLayout() {
        assertThat(MetamodelRegistry.layoutFor(DiagramKind.SEQ))
                .isEqualTo(MetamodelRegistry.LAYOUT_SEQUENCE);
        for (DiagramKind kind : DiagramKind.values()) {
            if (kind != DiagramKind.SEQ) {
                assertThat(MetamodelRegistry.layoutFor(kind)).isEqualTo(MetamodelRegistry.LAYOUT_ELK);
            }
        }
    }

    @Test
    void semanticElementIsImmutableAndDiagramOnlyReferencesIds() {
        ModelElement block = ModelElement.of("e-1", "Block", "动力控制器", "pkg-1");
        ModelElement renamed = block.withName("整车控制器");
        assertThat(block.name()).isEqualTo("动力控制器");
        assertThat(renamed.id()).isEqualTo("e-1");

        Diagram bdd = Diagram.of("d-1", DiagramKind.BDD, "系统结构", List.of("e-1"));
        assertThat(bdd.elementIds()).containsExactly("e-1");
        assertThat(MetamodelRegistry.allows(DiagramKind.BDD, ElementType.BLOCK)).isTrue();
        assertThat(MetamodelRegistry.allows(DiagramKind.BDD, ElementType.LIFELINE)).isFalse();
    }

    /**
     * 关系方向由元模型目录权威下发：模型树据此决定「单向挂源端一方 / 双向挂两端」，
     * 前端不得自己硬编码方向表。
     */
    @Test
    void relationshipDirectionIsMetamodelAuthority() {
        assertThat(RelationshipType.SATISFY.directed()).isTrue();
        assertThat(RelationshipType.VERIFY.directed()).isTrue();
        assertThat(RelationshipType.TRACE.directed()).isTrue();
        assertThat(RelationshipType.ASSOCIATION.directed()).isFalse();
        assertThat(RelationshipType.CONNECTOR.directed()).isFalse();
        assertThat(RelationshipType.BINDING.directed()).isFalse();
        long bidirectional = Arrays.stream(RelationshipType.values())
                .filter(type -> !type.directed()).count();
        assertThat(bidirectional).isEqualTo(3);
    }

    /** 扩展包定义来自静态元模型目录，与项目快照 / 项目根状态隔离。 */
    @Test
    void extensionLibraryIsIndependentOfProjectSnapshot() {
        List<ExtensionLibrary.Definition> definitions = ExtensionLibrary.definitions("model-root");
        assertThat(definitions).extracting(ExtensionLibrary.Definition::id)
                .contains(ExtensionLibrary.SYSML_PROFILE_ID, ExtensionLibrary.UML_PROFILE_ID);
        assertThat(definitions).allSatisfy(def -> assertThat(def.ownerId()).isNotBlank());
        assertThat(ExtensionLibrary.definitions("another-project-root"))
                .extracting(ExtensionLibrary.Definition::id)
                .containsExactlyElementsOf(definitions.stream()
                        .map(ExtensionLibrary.Definition::id).toList());
    }

    /**
     * 全量目录守卫：每个可建类型都必须同时具备「主图归属」「属性表」「挂载位置」。
     *
     * <p>新增类型时最容易漏的正是这三处——漏了主图归属，导入重排会丢元素；
     * 漏了 ROOTS，属性面板空白；漏了包含规则，右键菜单建不出来。</p>
     */
    @Test
    void everyElementTypeIsFullyRegistered() {
        for (ElementType type : ElementType.values()) {
            assertThat(MetamodelRegistry.primaryKind(type)).as("%s 缺少主图归属", type).isPresent();
            assertThat(PropertyCatalog.forType(type)).as("%s 缺少属性表", type).isNotEmpty();
            boolean placeable = ContainmentRules.isRootAllowed(type)
                    || Arrays.stream(ElementType.values())
                    .anyMatch(parent -> ContainmentRules.allows(parent, type));
            assertThat(placeable).as("%s 没有可挂载的父类型", type).isTrue();
        }
    }

    /** 每个规范元类都要么是顶层（Element），要么有父元类，不允许断链。 */
    @Test
    void everyMetaclassIsConnectedToTheHierarchy() {
        for (UmlMetaclass metaclass : UmlMetaclass.values()) {
            if (metaclass == UmlMetaclass.ELEMENT
                    || metaclass == UmlMetaclass.SCOFEN_CORE
                    || metaclass == UmlMetaclass.SCOFEN_RELATION) {
                continue;
            }
            assertThat(metaclass.parents()).as("%s 缺少父元类", metaclass).isNotEmpty();
        }
        // 抽象性按规范显式标注：Class 有子类但可实例化，Action / ControlNode 才是抽象的。
        assertThat(UmlMetaclass.ELEMENT.abstractMetaclass()).isTrue();
        assertThat(UmlMetaclass.ACTION.abstractMetaclass()).isTrue();
        assertThat(UmlMetaclass.CONTROL_NODE.abstractMetaclass()).isTrue();
        assertThat(UmlMetaclass.CLASS.abstractMetaclass()).isFalse();
        assertThat(UmlMetaclass.ENUMERATION.abstractMetaclass()).isFalse();
        assertThat(UmlMetaclass.SCOFEN_CORE.abstractMetaclass()).isFalse();
    }

    @Test
    void snapshotKeepsFourObjectSeparation() {
        ModelElement element = ModelElement.of("e-1", "Block", "A", null);
        Relationship rel = Relationship.of("r-1", "generalization", "e-1", "e-2");
        Diagram diagram = Diagram.of("d-1", DiagramKind.BDD, "BDD", List.of("e-1"));
        Notation notation = new Notation("n-1", "d-1", "e-1", 10, 20, 120, 60, java.util.Map.of());

        ModelSnapshot snapshot = new ModelSnapshot(7L,
                List.of(element), List.of(rel), List.of(diagram), List.of(notation));

        assertThat(snapshot.revision()).isEqualTo(7L);
        assertThat(snapshot.elements()).hasSize(1);
        assertThat(snapshot.relationships()).hasSize(1);
        assertThat(snapshot.diagrams()).hasSize(1);
        assertThat(snapshot.notations()).hasSize(1);
        assertThatThrownBy(() -> snapshot.elements().add(element))
                .isInstanceOf(UnsupportedOperationException.class);
    }
}
