package com.scofen.model.web.config;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.ExtensionSeeder;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.NoopPersistenceService;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.core.UndoStack;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.web.auth.AuthService;
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
    public PatchWebSocketHandler patchWebSocketHandler(AuthService authService) {
        return new PatchWebSocketHandler(authService);
    }

    @Bean
    public PatchBroker patchBroker(PatchWebSocketHandler handler) {
        return new PatchBroker(handler);
    }

    @Bean
    public CommandExecutor commandExecutor(InMemoryModelRepository repository, PatchBroker broker,
                                          PersistenceService persistence) {
        return new CommandExecutor(repository, new ValidationEngine(), broker, new UndoStack(), persistence);
    }

    @Bean
    public XmiExchangeService xmiExchangeService() {
        return new XmiExchangeService();
    }

    /**
     * 示例项目：唯一的项目根 Model → 三层父子模型树 + 覆盖九大图，
     * 且每张图只引用自身允许的元素类型。
     * 所有写入仍走 CommandExecutor，保证种子数据与用户编辑同一条协议。
     */
    @Bean
    public ApplicationRunner sampleModel(CommandExecutor executor, PersistenceService persistence) {
        return args -> {
            // 持久化模式：若已有快照则直接回载，跳过种子（做到重启不丢）
            if (persistence.isEnabled()) {
                persistence.loadLatest().ifPresent(snapshot -> {
                    executor.repository().load(snapshot);
                    System.out.println("[scofen] 已从 MySQL 回载模型快照，revision=" + snapshot.revision());
                });
                if (executor.repository().revision() > 0) {
                    return;
                }
            }
            // 项目根：SysML 的 Model 是模型树的唯一顶层节点，所有包/图都归其所有（直接或间接）。
            element(executor, "model-root", "Model", "车载动力系统工程模型", "", false);

            // 通用扩展包：SysML / UML 的元类与构造型随项目提供，
            // 属性面板里的「扩展的元类」「构造型」因此可以右键在模型树上定位。
            ExtensionSeeder.seed(executor, "model-root");

            // 项目根也是 Model 元类的实例，此时扩展包已就位，可以补上这条引用。
            run(executor, "UPDATE_PROPERTY", Map.of(
                    "id", "model-root", "key", "extendsMetaclass",
                    "value", ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(ElementType.MODEL))));

            element(executor, "pkg-1", "Package", "车载动力系统", "model-root");
            element(executor, "pkg-ctrl", "Package", "控制域", "pkg-1");
            element(executor, "e-vcu", "Block", "整车控制器", "pkg-ctrl");
            element(executor, "part-vcu", "PartProperty", "主控单元", "e-vcu");
            element(executor, "port-can", "Port", "CAN 接口", "part-vcu");
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

            // 图归其语义宿主所有：IBD/Par 归块/约束块，Act/Seq/Stm 归其对应行为元素，
            // 这样从图工具箱拖出的元素在 ContainmentRules 下都能合法挂载（见下方工具箱需求）。
            Map<String, String> diagramOwner = new LinkedHashMap<>();
            diagramOwner.put("pkg", "pkg-1");
            diagramOwner.put("req", "pkg-req");
            diagramOwner.put("bdd", "pkg-ctrl");
            diagramOwner.put("ibd", "e-vcu");
            diagramOwner.put("par", "cb-eff");
            diagramOwner.put("act", "act-charge");
            diagramOwner.put("seq", "int-charge");
            diagramOwner.put("stm", "stm-vcu");
            diagramOwner.put("uc", "pkg-1");

            for (DiagramKind kind : DiagramKind.values()) {
                run(executor, "CREATE_DIAGRAM", Map.of(
                        "id", "d-" + kind.code(),
                        "kind", kind.code(),
                        "name", kind.label() + "示例",
                        "ownerId", diagramOwner.getOrDefault(kind.code(), ""),
                        "elementIds", refsByKind.getOrDefault(kind.code(), List.of())));
            }

            // 种子完成后立即落库，保证持久化模式首启即有基线
            persistence.save(executor.snapshot());
            System.out.println("[scofen] 种子模型已生成并持久化，revision=" + executor.revision());
        };
    }

    private static void element(CommandExecutor executor, String id, String type, String name, String ownerId) {
        element(executor, id, type, name, ownerId, true);
    }

    /**
     * 种子元素。
     *
     * <p>元素自带「扩展的元类」：指向通用扩展包里的元类元素，
     * 属性面板里因此可以右键在模型树上定位到这条元类。
     * 项目根例外——它必须先于扩展包存在，那条引用随后单独补写。</p>
     */
    private static void element(CommandExecutor executor, String id, String type, String name, String ownerId,
                                boolean withMetaclass) {
        String stereotype = ElementType.fromAny(type).map(ElementType::stereotype).orElse("");
        Map<String, Object> properties = new LinkedHashMap<>();
        if (withMetaclass) {
            ElementType.fromAny(type).ifPresent(elementType -> properties.put(
                    "extendsMetaclass", ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(elementType))));
        }
        run(executor, "CREATE_ELEMENT", Map.of(
                "id", id, "type", type, "name", name, "ownerId", ownerId,
                "stereotypes", List.of(stereotype), "properties", properties));
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }
}
