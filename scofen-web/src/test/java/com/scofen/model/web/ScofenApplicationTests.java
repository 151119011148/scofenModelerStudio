package com.scofen.model.web;

import com.scofen.model.core.CommandExecutor;
import com.scofen.model.web.api.ModelController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/** 完整 Spring 上下文启动 + 九图示例数据注入。 */
@SpringBootTest
class ScofenApplicationTests {

    @Autowired
    private CommandExecutor executor;

    @Autowired
    private ModelController controller;

    @Test
    void contextLoadsAndSeedsAllNineDiagrams() {
        assertThat(executor.snapshot().diagrams()).hasSize(9);
        assertThat(executor.snapshot().elements()).hasSize(5);
        assertThat(controller.health()).containsEntry("product", "Scofen Modeler Studio");
    }
}
