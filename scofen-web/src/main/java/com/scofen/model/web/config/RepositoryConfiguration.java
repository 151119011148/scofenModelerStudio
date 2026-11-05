package com.scofen.model.web.config;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.web.ws.PatchBroker;
import com.scofen.model.web.ws.PatchWebSocketHandler;
import com.scofen.model.xmi.XmiExchangeService;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Configuration
public class RepositoryConfiguration {

    @Bean
    public InMemoryModelRepository modelRepository() {
        return new InMemoryModelRepository();
    }

    @Bean
    public PatchWebSocketHandler patchWebSocketHandler() {
        return new PatchWebSocketHandler();
    }

    @Bean
    public PatchBroker patchBroker(PatchWebSocketHandler handler) {
        return new PatchBroker(handler);
    }

    @Bean
    public CommandExecutor commandExecutor(InMemoryModelRepository repository, PatchBroker broker) {
        return new CommandExecutor(repository, new ValidationEngine(), broker);
    }

    @Bean
    public XmiExchangeService xmiExchangeService() {
        return new XmiExchangeService();
    }

    /**
     * 示例项目：三层父子模型树 + 覆盖九大图，且每张图只引用自身允许的元素类型。
     * 所有写入仍走 CommandExecutor，保证种子数据与用户编辑同一条协议。
     */
    @Bean
    public ApplicationRunner sampleModel(CommandExecutor executor) {
        return args -> {
            element(executor, "pkg-1", "Package", "车载动力系统", "");
            element(executor, "pkg-ctrl", "Package", "控制域", "pkg-1");
            element(executor, "e-vcu", "Block", "整车控制器", "pkg-ctrl");
            element(executor, "part-vcu", "PartProperty", "主控单元", "e-vcu");
            element(executor, "port-can", "Port", "CAN 接口", "e-vcu");
            element(executor, "e-bat", "Block", "动力电池", "pkg-ctrl");
            element(executor, "e-motor", "Block", "驱动电机", "pkg-ctrl");

            element(executor, "pkg-req", "Package", "需求域", "pkg-1");
            element(executor, "r-range", "Requirement", "续航里程 ≥ 500km", "pkg-req");
            element(executor, "r-charge", "Requirement", "快充 30 分钟", "r-range");
            element(executor, "tc-range", "TestCase", "续航验证", "r-range");

            element(executor, "act-charge", "Activity", "充电流程", "pkg-1");
            element(executor, "action-auth", "Action", "身份认证", "act-charge");
            element(executor, "uc-charge", "UseCase", "用户充电", "pkg-1");
            element(executor, "actor-driver", "Actor", "驾驶员", "pkg-1");
            element(executor, "stm-vcu", "StateMachine", "控制器状态机", "pkg-1");
            element(executor, "state-idle", "State", "待机", "stm-vcu");
            element(executor, "int-charge", "Interaction", "充电交互", "pkg-1");
            element(executor, "life-user", "Lifeline", "用户", "int-charge");
            element(executor, "cb-eff", "ConstraintBlock", "效率约束", "pkg-1");

            run(executor, "CREATE_RELATIONSHIP", Map.of("id", "rel-1", "type", "satisfy",
                    "sourceId", "e-vcu", "targetId", "r-range"));
            run(executor, "CREATE_RELATIONSHIP", Map.of("id", "rel-2", "type", "verify",
                    "sourceId", "tc-range", "targetId", "r-range"));

            Map<String, List<String>> refsByKind = new LinkedHashMap<>();
            refsByKind.put("pkg", List.of("pkg-1", "pkg-ctrl", "pkg-req"));
            refsByKind.put("req", List.of("r-range", "r-charge", "tc-range"));
            refsByKind.put("bdd", List.of("e-vcu", "e-bat", "e-motor"));
            refsByKind.put("ibd", List.of("part-vcu", "port-can"));
            refsByKind.put("par", List.of("cb-eff"));
            refsByKind.put("act", List.of("act-charge", "action-auth"));
            refsByKind.put("seq", List.of("int-charge", "life-user"));
            refsByKind.put("stm", List.of("stm-vcu", "state-idle"));
            refsByKind.put("uc", List.of("uc-charge", "actor-driver"));

            for (DiagramKind kind : DiagramKind.values()) {
                run(executor, "CREATE_DIAGRAM", Map.of(
                        "id", "d-" + kind.code(),
                        "kind", kind.code(),
                        "name", kind.label() + "示例",
                        "elementIds", refsByKind.getOrDefault(kind.code(), List.of())));
            }
        };
    }

    private static void element(CommandExecutor executor, String id, String type, String name, String ownerId) {
        String stereotype = ElementType.fromAny(type).map(ElementType::stereotype).orElse("");
        run(executor, "CREATE_ELEMENT", Map.of(
                "id", id, "type", type, "name", name, "ownerId", ownerId,
                "stereotypes", List.of(stereotype)));
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }
}
