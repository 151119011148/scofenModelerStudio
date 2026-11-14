package com.scofen.model.core;

import com.scofen.model.metamodel.Relationship;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 序列图的时间槽顺序是模型数据：一批 message 关系的 messageOrder 由一条命令整批写完，
 * 一个 revision、一个 Patch、一步撤销——拖动重排不能退化成 N 条 UPDATE_PROPERTY。
 */
class MessageOrderCommandTest {

    private static final String SESSION = "message-order-session";

    private final List<Patch> published = new ArrayList<>();
    private CommandExecutor executor;
    private int counter;

    @BeforeEach
    void setUp() {
        published.clear();
        counter = 0;
        executor = new CommandExecutor(new InMemoryModelRepository(), new ValidationEngine(), published::add);
        cmd("CREATE_ELEMENT", Map.of("id", "pkg", "type", "Package", "name", "系统", "ownerId", ""));
        cmd("CREATE_ELEMENT", Map.of("id", "int1", "type", "Interaction", "name", "下单交互", "ownerId", "pkg"));
        cmd("CREATE_ELEMENT", Map.of("id", "life1", "type", "Lifeline", "name", "用户", "ownerId", "int1"));
        cmd("CREATE_ELEMENT", Map.of("id", "life2", "type", "Lifeline", "name", "订单服务", "ownerId", "int1"));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "msg1", "type", "message",
                "sourceId", "life1", "targetId", "life2", "name", "提交订单",
                "properties", Map.of("messageOrder", 1000)));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "msg2", "type", "message",
                "sourceId", "life2", "targetId", "life1", "name", "返回结果",
                "properties", Map.of("messageOrder", 2000)));
        cmd("CREATE_RELATIONSHIP", Map.of("id", "rel-satisfy", "type", "satisfy",
                "sourceId", "life1", "targetId", "life2"));
    }

    private Patch cmd(String type, Map<String, Object> payload) {
        return executor.execute(SESSION, Command.of(type, executor.revision(), "order-" + (++counter), payload));
    }

    private Relationship relationship(String id) {
        return executor.snapshot().relationships().stream()
                .filter(r -> r.id().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void messageOrderIsWritableModelProperty() {
        assertThat(relationship("msg1").property("messageOrder")).isEqualTo(1000);
        assertThat(relationship("msg2").property("messageOrder")).isEqualTo(2000);

        cmd("UPDATE_PROPERTY", Map.of("id", "msg1", "key", "messageOrder", "value", 3000));
        assertThat(relationship("msg1").property("messageOrder")).isEqualTo(3000);
    }

    @Test
    void reordersWholeTimelineInOneRevisionAndOnePatch() {
        long before = executor.revision();
        int patches = published.size();
        cmd("SET_MESSAGE_ORDER", Map.of("items", List.of(
                Map.of("id", "msg2", "order", 1000),
                Map.of("id", "msg1", "order", 2000))));

        assertThat(executor.revision()).isEqualTo(before + 1);
        assertThat(published).hasSize(patches + 1);
        assertThat(relationship("msg2").property("messageOrder")).isEqualTo(1000);
        assertThat(relationship("msg1").property("messageOrder")).isEqualTo(2000);
        // 只动 messageOrder，端点与名称逐字段不变。
        assertThat(relationship("msg1").sourceId()).isEqualTo("life1");
        assertThat(relationship("msg1").name()).isEqualTo("提交订单");
    }

    @Test
    void undoRestoresPreviousOrdersInOneStep() {
        cmd("SET_MESSAGE_ORDER", Map.of("items", List.of(
                Map.of("id", "msg1", "order", 2000),
                Map.of("id", "msg2", "order", 1000))));
        assertThat(relationship("msg2").property("messageOrder")).isEqualTo(1000);

        executor.undo(SESSION);
        assertThat(relationship("msg1").property("messageOrder")).isEqualTo(1000);
        assertThat(relationship("msg2").property("messageOrder")).isEqualTo(2000);
    }

    @Test
    void undoRemovesFieldThatWasAbsentBefore() {
        cmd("CREATE_RELATIONSHIP", Map.of("id", "msg3", "type", "message",
                "sourceId", "life1", "targetId", "life2", "name", "无序号的老消息"));
        cmd("SET_MESSAGE_ORDER", Map.of("items", List.of(Map.of("id", "msg3", "order", 3000))));
        assertThat(relationship("msg3").property("messageOrder")).isEqualTo(3000);

        executor.undo(SESSION);
        assertThat(relationship("msg3").property("messageOrder")).isNull();
    }

    @Test
    void rejectsNonMessageRelationshipsAndNonIntegerOrders() {
        assertThatThrownBy(() -> cmd("SET_MESSAGE_ORDER", Map.of("items",
                List.of(Map.of("id", "rel-satisfy", "order", 1000)))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("message");

        assertThatThrownBy(() -> cmd("SET_MESSAGE_ORDER", Map.of("items",
                List.of(Map.of("id", "msg1", "order", 1.5)))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("整数");

        assertThatThrownBy(() -> cmd("SET_MESSAGE_ORDER", Map.of("items",
                List.of(Map.of("id", "no-such-message", "order", 1000)))))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("Unknown relationship");
    }
}
