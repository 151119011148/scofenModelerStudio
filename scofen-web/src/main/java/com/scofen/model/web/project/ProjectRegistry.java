package com.scofen.model.web.project;

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
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.PropertyCatalog;
import com.scofen.model.web.persistence.PersistenceServiceFactory;
import com.scofen.model.web.workspace.WorkspaceDirectory;
import com.scofen.model.web.ws.PatchBroker;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 多项目模型运行时（M0 内存态）。
 *
 * <p>每个项目拥有独立的 Repository / CommandExecutor / 撤销栈，因此 revision、
 * 元素、图、撤销历史都互不干扰；打开项目只是把请求路由到对应 executor。
 * 主示例项目沿用 Spring 的单例 CommandExecutor（带种子数据），其它项目在
 * 首次打开时懒初始化：唯一项目根 Package + 九张空图，随后即可正常编辑。</p>
 *
 * <p>所有项目共用同一个 PatchBroker，因此跨项目的 WS 广播只会让跟随者
 * 重新拉取自己项目的快照，不会造成数据串写。M0 不落库，重启后回到基线。</p>
 */
@Component
public class ProjectRegistry {

    private final CommandExecutor primary;
    private final PatchBroker broker;
    private final WorkspaceDirectory directory;
    private final PersistenceServiceFactory factory;
    private final Map<String, CommandExecutor> runtimes = new ConcurrentHashMap<>();

    public ProjectRegistry(CommandExecutor primary, PatchBroker broker, WorkspaceDirectory directory,
                           PersistenceServiceFactory factory) {
        this.primary = primary;
        this.broker = broker;
        this.directory = directory;
        this.factory = factory;
    }

    public CommandExecutor resolve(String projectId) {
        if (isPrimary(projectId)) {
            return primary;
        }
        // 未知项目一律拒绝：否则任何还带着旧项目头的请求（已删项目的 WS 重连、
        // 浏览器里的历史请求）都能凭空造出一个「野生运行时」并整包写回库，
        // 删掉的项目就会以「新建项目」的名字复活。
        if (directory.findProject(projectId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在：" + projectId);
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

    /**
     * 丢弃项目的运行时（删除项目时调用）。
     *
     * <p>主示例项目与 Spring 单例 executor 绑定，不在 runtimes 里，因此不参与删除；
     * 其它项目把运行时从 map 中摘掉，之后的目录统计会显示为「未打开」，
     * 也不会再有残留的撤销栈或 WS 会话持有它的旧快照。</p>
     */
    public boolean remove(String projectId) {
        if (isPrimary(projectId)) {
            return false;
        }
        return runtimes.remove(projectId) != null;
    }

    private boolean isPrimary(String projectId) {
        return projectId == null || projectId.isBlank()
                || WorkspaceDirectory.CURRENT_PROJECT_ID.equals(projectId);
    }

    private CommandExecutor create(String projectId) {
        PersistenceService persistence = factory.forProject(projectId);
        InMemoryModelRepository repository = new InMemoryModelRepository();
        // 播种期间先摘掉持久化，避免每条种子命令都写一份整包快照。
        CommandExecutor executor = new CommandExecutor(
                repository, new ValidationEngine(), broker, new UndoStack(), new NoopPersistenceService());

        // 落库模式：优先回载已有快照，重启后模型不丢。
        if (persistence.isEnabled()) {
            Optional<ModelSnapshot> latest = persistence.loadLatest();
            if (latest.isPresent()) {
                repository.load(latest.get());
                // 存量项目（老版本的根是 Model）就地归一为 Package，并重写一次当前快照。
                if (persistence.isEnabled() && ProjectRoot.normalize(repository)) {
                    persistence.save(repository.snapshot());
                    System.out.println("[scofen] 项目根已归一为 Package，project=" + projectId);
                }
                // 扩展包随版本演进：升级后新增的元类 / 构造型 / 标准库给存量项目补齐一次。
                if (ExtensionSeeder.sync(executor, ProjectRoot.ID) && persistence.isEnabled()) {
                    persistence.save(executor.snapshot());
                    System.out.println("[scofen] 扩展包已补齐到当前版本，project=" + projectId);
                }
                executor.setPersistence(persistence);
                return executor;
            }
        }

        String name = directory.findProject(projectId)
                .map(WorkspaceDirectory.Project::name)
                .orElse("新建项目");
        run(executor, "CREATE_ELEMENT", Map.of(
                "id", ProjectRoot.ID, "type", ProjectRoot.TYPE_CODE, "name", name, "ownerId", ""));
        // 通用扩展包随项目一起提供：SysML / UML 的元类与构造型。
        ExtensionSeeder.seed(executor, ProjectRoot.ID);
        run(executor, "UPDATE_PROPERTY", Map.of(
                "id", ProjectRoot.ID, "key", "extendsMetaclass",
                "value", ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(ProjectRoot.TYPE))));
        for (DiagramKind kind : DiagramKind.values()) {
            run(executor, "CREATE_DIAGRAM", Map.of(
                    "id", "d-" + kind.code(),
                    "kind", kind.code(),
                    "name", kind.label() + "示例",
                    "ownerId", ProjectRoot.ID,
                    "elementIds", List.of()));
        }
        // 种子完成才挂上持久化并整包落库一次。
        executor.setPersistence(persistence);
        if (persistence.isEnabled()) {
            persistence.save(executor.snapshot());
        }
        return executor;
    }

    private static void run(CommandExecutor executor, String type, Map<String, Object> payload) {
        executor.execute("system", Command.of(type, executor.revision(),
                "seed-" + type + "-" + payload.get("id"), payload));
    }
}
