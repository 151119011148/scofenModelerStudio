package com.scofen.model.web.project;

import com.scofen.model.core.Command;
import com.scofen.model.core.CommandExecutor;
import com.scofen.model.core.ExtensionSeeder;
import com.scofen.model.core.InMemoryModelRepository;
import com.scofen.model.core.ValidationEngine;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 多项目模型运行时（M0 内存态）。
 *
 * <p>每个项目拥有独立的 Repository / CommandExecutor / 撤销栈，因此 revision、
 * 元素、图、撤销历史都互不干扰；打开项目只是把请求路由到对应 executor。
 * 主示例项目沿用 Spring 的单例 CommandExecutor（带种子数据），其它项目在
 * 首次打开时懒初始化：唯一项目根 Model + 九张空图，随后即可正常编辑。</p>
 *
 * <p>所有项目共用同一个 PatchBroker，因此跨项目的 WS 广播只会让跟随者
 * 重新拉取自己项目的快照，不会造成数据串写。M0 不落库，重启后回到基线。</p>
 */
@Component
public class ProjectRegistry {

    private final CommandExecutor primary;
    private final PatchBroker broker;
    private final WorkspaceDirectory directory;
    private final Map<String, CommandExecutor> runtimes = new ConcurrentHashMap<>();

    public ProjectRegistry(CommandExecutor primary, PatchBroker broker, WorkspaceDirectory directory) {
        this.primary = primary;
        this.broker = broker;
        this.directory = directory;
    }

    public CommandExecutor resolve(String projectId) {
        if (isPrimary(projectId)) {
            return primary;
        }
        return runtimes.computeIfAbsent(projectId, this::create);
    }

    /** 只取已打开的运行时，用于目录统计，避免因浏览列表而生成一堆空模型。 */
    public CommandExecutor peek(String projectId) {
        if (isPrimary(projectId)) {
            return primary;
        }
        return runtimes.get(projectId);
    }

    public boolean isOpened(String projectId) {
        return isPrimary(projectId) || runtimes.containsKey(projectId);
    }

    private boolean isPrimary(String projectId) {
        return projectId == null || projectId.isBlank()
                || WorkspaceDirectory.CURRENT_PROJECT_ID.equals(projectId);
    }

    private CommandExecutor create(String projectId) {
        CommandExecutor executor = new CommandExecutor(
                new InMemoryModelRepository(), new ValidationEngine(), broker);
        String name = directory.findProject(projectId)
                .map(WorkspaceDirectory.Project::name)
                .orElse("新建项目");
        run(executor, "CREATE_ELEMENT", Map.of(
                "id", "model-root", "type", "Model", "name", name, "ownerId", ""));
        // 通用扩展包随项目一起提供：SysML / UML 的元类与构造型。
        ExtensionSeeder.seed(executor, "model-root");
        run(executor, "UPDATE_PROPERTY", Map.of(
                "id", "model-root", "key", "extendsMetaclass",
                "value", ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(ElementType.MODEL))));
        for (DiagramKind kind : DiagramKind.values()) {
            run(executor, "CREATE_DIAGRAM", Map.of(
                    "id", "d-" + kind.code(),
                    "kind", kind.code(),
                    "name", kind.label() + "示例",
                    "ownerId", "model-root",
                    "elementIds", List.of()));
        }
        return executor;
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }
}
