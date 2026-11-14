package com.scofen.model.web;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.web.api.ModelController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/** 完整 Spring 上下文启动 + 三层模型树与九图示例数据注入。 */
@SpringBootTest
class ScofenApplicationTests {

    @Autowired
    private CommandExecutor executor;

    @Autowired
    private ModelController controller;

    @Test
    void contextLoadsAndSeedsHierarchicalModelAndAllNineDiagrams() {
        ModelSnapshot snapshot = executor.snapshot();
        assertThat(snapshot.diagrams()).hasSize(9);
        // 25 个示例元素（含序列图里被创建/销毁的生命线与组合片段示例）+ 通用扩展包（SysML / UML 的元类与构造型）
        assertThat(snapshot.elements()).hasSize(25 + ExtensionLibrary.size());
        assertThat(snapshot.elements()).extracting(ModelElement::id)
                .contains("model-root", "pkg-1", "pkg-ctrl", "e-vcu", "part-vcu", "r-range", "life-user",
                        ExtensionLibrary.SYSML_PROFILE_ID, ExtensionLibrary.UML_PROFILE_ID);
        // 项目根 Package 是唯一顶层节点，既有顶层包已 reparent 到它下面
        assertThat(snapshot.elements()).filteredOn(e -> e.id().equals("model-root"))
                .singleElement().satisfies(root -> {
                    assertThat(root.type()).isEqualTo("Package");
                    assertThat(root.ownerId()).isNull();
                });
        assertThat(snapshot.elements()).filteredOn(e -> e.ownerId() == null)
                .extracting(ModelElement::id).containsExactly("model-root");
        assertThat(snapshot.elements()).filteredOn(e -> e.id().equals("pkg-1"))
                .extracting(ModelElement::ownerId).containsExactly("model-root");
        // 三层父子关系：包 → 块 → 部件
        assertThat(snapshot.elements()).filteredOn(e -> "part-vcu".equals(e.id()))
                .extracting(ModelElement::ownerId).containsExactly("e-vcu");
        assertThat(snapshot.notations()).hasSizeGreaterThanOrEqualTo(9);
        assertThat(snapshot.diagrams()).allSatisfy(diagram ->
                assertThat(snapshot.notations()).anySatisfy(n ->
                        assertThat(n.diagramId()).isEqualTo(diagram.id())));
        assertThat(controller.health("default")).containsEntry("product", "Scofen Modeler Studio");
    }

    @Test
    void seededElementsPointAtTheirMetaclassInsideTheExtensionPackage() {
        ModelSnapshot snapshot = executor.snapshot();
        ModelElement vcu = snapshot.elements().stream()
                .filter(item -> item.id().equals("e-vcu"))
                .findFirst()
                .orElseThrow();
        // 「扩展的元类」指向通用扩展包里的元类元素，属性面板可据此右键定位
        assertThat(vcu.properties()).containsEntry("extendsMetaclass", "mc-SYSML_BLOCK");
        assertThat(snapshot.elements()).extracting(ModelElement::id).contains("mc-SYSML_BLOCK", "st-block");
    }

    @Test
    void containmentRulesAreExposedToTheBrowser() {        var containment = controller.containment();
        assertThat(containment).containsKeys("rootTypes", "rules", "types", "canvas", "node");
        assertThat(containment.get("rootTypes"))
                .isEqualTo(java.util.List.of("PACKAGE", "MODEL", "MODEL_LIBRARY", "PROFILE"));
        assertThat((java.util.List<?>) containment.get("types")).hasSize(
                com.scofen.model.metamodel.ElementType.values().length);
    }
}
