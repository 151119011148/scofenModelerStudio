package com.scofen.model.web;

import com.scofen.model.core.CommandExecutor;
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
        assertThat(snapshot.elements()).hasSize(20);
        assertThat(snapshot.elements()).extracting(ModelElement::id)
                .contains("pkg-1", "pkg-ctrl", "e-vcu", "part-vcu", "r-range", "life-user");
        // 三层父子关系：包 → 块 → 部件
        assertThat(snapshot.elements()).filteredOn(e -> "part-vcu".equals(e.id()))
                .extracting(ModelElement::ownerId).containsExactly("e-vcu");
        assertThat(snapshot.notations()).hasSizeGreaterThanOrEqualTo(9);
        assertThat(snapshot.diagrams()).allSatisfy(diagram ->
                assertThat(snapshot.notations()).anySatisfy(n ->
                        assertThat(n.diagramId()).isEqualTo(diagram.id())));
        assertThat(controller.health()).containsEntry("product", "Scofen Modeler Studio");
    }

    @Test
    void containmentRulesAreExposedToTheBrowser() {
        var containment = controller.containment();
        assertThat(containment).containsKeys("rootTypes", "rules", "types", "canvas", "node");
        assertThat(containment.get("rootTypes"))
                .isEqualTo(java.util.List.of("PACKAGE", "MODEL", "MODEL_LIBRARY", "PROFILE"));
        assertThat((java.util.List<?>) containment.get("types")).hasSize(
                com.scofen.model.metamodel.ElementType.values().length);
    }
}
