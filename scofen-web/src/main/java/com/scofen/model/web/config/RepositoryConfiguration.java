package com.scofen.model.web.config;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.ExtensionSeeder;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.NoopPersistenceService;
import com.scofen.model.core.PersistenceService;
import com.scofen.model.core.ProjectRoot;
import com.scofen.model.core.UndoStack;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.web.auth.AuthService;
import com.scofen.model.web.persistence.PersistenceServiceFactory;
import com.scofen.model.web.workspace.WorkspaceDirectory;
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
                                          PersistenceServiceFactory factory) {
        // 主项目也按项目隔离绑定持久化实例：多个项目各写各的快照，不会互相覆盖。
        return new CommandExecutor(repository, new ValidationEngine(), broker, new UndoStack(),
                factory.forProject(WorkspaceDirectory.CURRENT_PROJECT_ID));
    }

    @Bean
    public XmiExchangeService xmiExchangeService() {
        return new XmiExchangeService();
    }

    /**
     * 示例项目：唯一的项目根 Package → 三层父子模型树 + 覆盖九大图，
     * 且每张图只引用自身允许的元素类型。
     * 所有写入仍走 CommandExecutor，保证种子数据与用户编辑同一条协议。
     */
    @Bean
    public ApplicationRunner sampleModel(CommandExecutor executor, PersistenceServiceFactory factory) {
        return args -> {
            PersistenceService persistence = factory.forProject(WorkspaceDirectory.CURRENT_PROJECT_ID);
            // 持久化模式：若已有快照则直接回载，跳过种子（做到重启不丢）
            if (persistence.isEnabled()) {
                persistence.loadLatest().ifPresent(snapshot -> {
                    executor.repository().load(snapshot);
                    System.out.println("[scofen] 已从 MySQL 回载模型快照，revision=" + snapshot.revision());
                });
                if (executor.repository().revision() > 0) {
                    // 存量项目（老版本的根是 Model）就地归一为 Package，并重写一次当前快照。
                    if (ProjectRoot.normalize(executor.repository())) {
                        persistence.save(executor.repository().snapshot());
                        System.out.println("[scofen] 项目根已归一为 Package，project="
                                + WorkspaceDirectory.CURRENT_PROJECT_ID);
                    }
                    // 扩展包随版本演进：升级后新增的元类 / 构造型 / 原始类型库 / 单位库
                    // 要给存量项目补齐一次——否则用户升级后仍然见不到 String 这类值类型。
                    if (ExtensionSeeder.sync(executor, ProjectRoot.ID)) {
                        persistence.save(executor.repository().snapshot());
                        System.out.println("[scofen] 扩展包已补齐到当前版本，project="
                                + WorkspaceDirectory.CURRENT_PROJECT_ID);
                    }
                    return;
                }
                // 播种期间先摘掉持久化，避免每条种子命令都写一份整包快照。
                executor.setPersistence(new NoopPersistenceService(WorkspaceDirectory.CURRENT_PROJECT_ID));
            }
            // 项目根：Package 作为项目容器，其下可组织一个或多个 Model（模型节点）。
            element(executor, ProjectRoot.ID, ProjectRoot.TYPE_CODE, "车载动力系统工程模型", "", false);

            // 通用扩展包：SysML / UML 的元类与构造型随项目提供，
            // 属性面板里的「扩展的元类」「构造型」因此可以右键在模型树上定位。
            ExtensionSeeder.seed(executor, "model-root");

            // 项目根也是 Package 元类的实例，此时扩展包已就位，可以补上这条引用。
            run(executor, "UPDATE_PROPERTY", Map.of(
                    "id", ProjectRoot.ID, "key", "extendsMetaclass",
                    "value", ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(ProjectRoot.TYPE))));

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
            element(executor, "life-pile", "Lifeline", "充电桩", "int-charge");
            element(executor, "life-bms", "Lifeline", "电池管理系统", "int-charge");
            // 由 createMessage 创建、再由 deleteMessage 销毁的生命线：表头不在公共表头行。
            element(executor, "life-session", "Lifeline", "充电会话", "int-charge");
            element(executor, "cb-eff", "ConstraintBlock", "效率约束", "pkg-1");

            // 组合片段：区间（起始/结束消息排位）与守卫都是可写元属性，图面按区间现算框。
            // 覆盖 3..4（鉴权 / 返回），避开被创建生命线的表头，免得框线横穿表头。
            element(executor, "frag-charge-opt", "CombinedFragment", "可选：鉴权", "int-charge");
            run(executor, "UPDATE_PROPERTY", Map.of("id", "frag-charge-opt", "key", "interactionOperator", "value", "opt"));
            run(executor, "UPDATE_PROPERTY", Map.of("id", "frag-charge-opt", "key", "coveredFrom", "value", 3));
            run(executor, "UPDATE_PROPERTY", Map.of("id", "frag-charge-opt", "key", "coveredTo", "value", 4));
            run(executor, "UPDATE_PROPERTY", Map.of("id", "frag-charge-opt", "key", "guards",
                    "value", List.of("鉴权通过")));

            run(executor, "CREATE_RELATIONSHIP", Map.of("id", "rel-1", "type", "satisfy",
                    "sourceId", "e-vcu", "targetId", "r-range"));
            run(executor, "CREATE_RELATIONSHIP", Map.of("id", "rel-2", "type", "verify",
                    "sourceId", "tc-range", "targetId", "r-range"));

            /*
             * 序列图示例覆盖工具箱里的七种消息组件：同步 / 异步 / 异步信号 / 返回 /
             * 创建 / 销毁 / 给自己的消息。四条生命线里「充电会话」由第 6 条消息创建、
             * 第 7 条消息销毁，表头因此落在创建行下方、虚线终止于销毁行并画 X。
             * messageOrder 是时间槽顺序（模型数据，不是创建顺序），messageSort 决定线型。
             */
            message(executor, "msg-plug", "插入充电枪", "life-user", "life-pile", 1, null);
            message(executor, "msg-self-check", "设备自检", "life-pile", "life-pile", 2, null);
            message(executor, "msg-auth", "请求鉴权", "life-pile", "life-bms", 3, "asynchCall");
            message(executor, "msg-auth-ok", "鉴权通过", "life-bms", "life-pile", 4, "reply");
            message(executor, "msg-status", "状态上报", "life-bms", "life-user", 5, "asynchSignal");
            message(executor, "msg-create-session", "创建充电会话", "life-pile", "life-session", 6, "createMessage");
            message(executor, "msg-destroy-session", "结束并销毁会话", "life-pile", "life-session", 7, "deleteMessage");

            Map<String, List<String>> refsByKind = new LinkedHashMap<>();
            refsByKind.put("pkg", List.of("pkg-1", "pkg-ctrl", "pkg-req"));
            refsByKind.put("req", List.of("r-range", "r-charge", "tc-range"));
            refsByKind.put("bdd", List.of("e-vcu", "e-bat", "e-motor"));
            refsByKind.put("ibd", List.of("part-vcu", "port-can"));
            refsByKind.put("par", List.of("cb-eff"));
            refsByKind.put("act", List.of("act-charge", "action-auth"));
            refsByKind.put("seq", List.of("int-charge", "life-user", "life-pile", "life-bms",
                    "life-session", "frag-charge-opt"));
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

            // 四条生命线按列铺开（记法 x 就是列序），交互自身的位置无所谓——它画成图框包住全图。
            // 表头统一收窄到 132、列距 140，四列都留在 640 的默认画布宽度内；
            // 七条消息的时间轴比 420 的默认画布高，前端打开序列图时会自动适应窗口一次。
            run(executor, "SET_NOTATIONS", Map.of("items", List.of(
                    Map.of("diagramId", "d-seq", "elementId", "int-charge", "x", 20, "y", 30),
                    Map.of("diagramId", "d-seq", "elementId", "life-user", "x", 20, "y", 40, "width", 132, "height", 44),
                    Map.of("diagramId", "d-seq", "elementId", "life-pile", "x", 160, "y", 40, "width", 132, "height", 44),
                    Map.of("diagramId", "d-seq", "elementId", "life-bms", "x", 300, "y", 40, "width", 132, "height", 44),
                    Map.of("diagramId", "d-seq", "elementId", "life-session", "x", 440, "y", 40, "width", 132, "height", 44),
                    Map.of("diagramId", "d-seq", "elementId", "frag-charge-opt", "x", 20, "y", 230))));

            // 种子完成后立即落库，保证持久化模式首启即有基线
            executor.setPersistence(persistence);
            if (persistence.isEnabled()) {
                persistence.save(executor.snapshot());
            }
            System.out.println("[scofen] 种子模型已生成，revision=" + executor.revision());
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

    /**
     * 序列图的一条消息：两端是生命线，第几条落成 messageOrder（1 起），
     * 线型由 messageSort 决定。缺省 messageSort 就是 synchCall，不必写。
     */
    private static void message(CommandExecutor executor, String id, String name,
                                String sourceId, String targetId, int slot, String sort) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("messageOrder", slot);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", id);
        payload.put("type", "message");
        payload.put("sourceId", sourceId);
        payload.put("targetId", targetId);
        payload.put("name", name);
        payload.put("properties", properties);
        run(executor, "CREATE_RELATIONSHIP", payload);
        if (sort != null) {
            run(executor, "UPDATE_PROPERTY", Map.of("id", id, "key", "messageSort", "value", sort));
        }
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        // 同一个元素连续写多条 UPDATE_PROPERTY 时，幂等键必须把 key 带上：
        // 否则「seed-UPDATE_PROPERTY-frag-charge-opt」四条全撞同一个键，只有第一条生效。
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id") + "-" + payload.getOrDefault("key", ""), payload));
    }
}
