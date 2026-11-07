package com.scofen.model.core;

import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 项目根固定为 Package：存量快照（根曾是 Model）的幂等归一。 */
class ProjectRootTest {

    private InMemoryModelRepository repositoryWith(String rootType, long revision) {
        InMemoryModelRepository repository = new InMemoryModelRepository();
        repository.load(new ModelSnapshot(revision,
                List.of(new ModelElement("model-root", rootType, "示例项目", List.of("model"),
                                null, "根文档", Map.of("k", "v"), "xmi-root",
                                Map.of("extendsMetaclass", "mc-MODEL")),
                        new ModelElement("child", "Block", "控制器", List.of("block"),
                                "model-root", "", Map.of(), null, Map.of())),
                List.of(), List.of(), List.of()));
        return repository;
    }

    @Test
    void legacyModelRootIsNormalizedToPackageWithoutTouchingOtherFields() {
        InMemoryModelRepository repository = repositoryWith("Model", 42L);

        assertThat(ProjectRoot.normalize(repository)).isTrue();
        ModelSnapshot snapshot = repository.snapshot();
        ModelElement root = snapshot.elements().get(0);

        assertThat(root.type()).isEqualTo(ProjectRoot.TYPE_CODE);
        assertThat(root.id()).isEqualTo(ProjectRoot.ID);
        assertThat(root.ownerId()).isNull();
        // 其余字段一律保留，归一不是重新播种。
        assertThat(root.name()).isEqualTo("示例项目");
        assertThat(root.documentation()).isEqualTo("根文档");
        assertThat(root.taggedValues()).containsEntry("k", "v");
        assertThat(root.xmiId()).isEqualTo("xmi-root");
        assertThat(root.properties()).containsEntry("extendsMetaclass",
                com.scofen.model.metamodel.ExtensionLibrary.metaclassId(
                        com.scofen.model.metamodel.PropertyCatalog.rootMetaclass(ElementType.PACKAGE)));
        assertThat(snapshot.elements().get(1).ownerId()).isEqualTo("model-root");
        // 数据迁移不推进 revision，也不产生 Patch。
        assertThat(snapshot.revision()).isEqualTo(42L);
    }

    @Test
    void normalizeIsIdempotentAndLeavesPackageRootUntouched() {
        InMemoryModelRepository repository = repositoryWith(ProjectRoot.TYPE_CODE, 7L);
        ModelSnapshot before = repository.snapshot();

        assertThat(ProjectRoot.normalize(repository)).isFalse();
        assertThat(repository.snapshot().elements()).isEqualTo(before.elements());
    }

    @Test
    void snapshotNormalizeKeepsDiagramsAndNotations() {
        ModelSnapshot snapshot = repositoryWith("Model", 3L).snapshot();

        ModelSnapshot normalized = ProjectRoot.normalize(snapshot);

        assertThat(normalized.elements().get(0).type()).isEqualTo(ProjectRoot.TYPE_CODE);
        assertThat(normalized.revision()).isEqualTo(3L);
        assertThat(normalized.diagrams()).isEmpty();
        assertThat(normalized.notations()).isEmpty();
        assertThat(ProjectRoot.normalize(normalized)).isSameAs(normalized);
    }

    @Test
    void onlyTheFirstTopLevelElementIsNormalized() {
        // 外部 XMI 常见的多顶层结构：项目根之外还有独立的 Profile / Model。
        // 只有第一个顶层元素受「项目根固定为 Package」约定约束，其余保持原类型。
        InMemoryModelRepository repository = new InMemoryModelRepository();
        repository.load(new ModelSnapshot(1L,
                List.of(new ModelElement("model-root", "Model", "项目", List.of(), null,
                                "", Map.of(), null, Map.of()),
                        new ModelElement("other-profile", "Profile", "外部剖面", List.of(), null,
                                "", Map.of(), null, Map.of()),
                        new ModelElement("other-model", "Model", "外部模型", List.of(), null,
                                "", Map.of(), null, Map.of())),
                List.of(), List.of(), List.of()));

        assertThat(ProjectRoot.normalize(repository)).isTrue();
        assertThat(repository.snapshot().elements()).extracting(ModelElement::type)
                .containsExactly(ProjectRoot.TYPE_CODE, "Profile", "Model");
    }
}
