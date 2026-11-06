package com.scofen.model.web.workspace;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 个人空间 / 团队空间下的项目目录。
 *
 * <p>目录元数据不属于模型四对象（Element / Relationship / Diagram / Notation），
 * 因此不走 CommandExecutor 与全局 revision；项目统计由
 * {@code WorkspaceController} 从对应项目的模型快照实时取出。</p>
 *
 * <p>每个项目都可以打开，打开后由 ProjectRegistry 分配独立的模型运行时；
 * 所有项目共用同一套元模型与校验规则。</p>
 *
 * <p><b>落库模式</b>：目录本身也要持久化。模型快照按项目 id 落库，
 * 若目录只在内存里，重启后项目列表复位，先前落库的模型就再也回不来，
 * 「重启不丢」就成了空话。因此落库模式下目录从 {@link ProjectDirectoryStore} 读取，
 * 首次启动（库为空）时把内置默认目录写入库。</p>
 */
@Component
public final class WorkspaceDirectory {

    public static final String PERSONAL = "personal";
    public static final String TEAM = "team";
    public static final String CURRENT_PROJECT_ID = "project-vehicle";

    public record Space(String code, String label, String kind, String owner, int memberCount) {
    }

    public record Project(String id, String name, String description, String owner,
                          String updatedAt, String status, boolean current, boolean editable,
                          String spaceCode) {
    }

    private final List<Space> spaces = List.of(
            new Space(PERSONAL, "个人空间", "personal", "我", 1),
            new Space(TEAM, "团队空间", "team", "系统工程组", 6));

    private final Map<String, CopyOnWriteArrayList<Project>> projects = new ConcurrentHashMap<>();
    private final ProjectDirectoryStore store;

    public WorkspaceDirectory() {
        this(new NoopProjectDirectoryStore());
    }

    /**
     * Spring 走这个构造器注入目录存储。
     * <b>必须显式标 {@code @Autowired}</b>：本类有两个构造器时，Spring 默认选无参的那个，
     * 于是目录存储会退化成内存实现——目录不落库，重启后目录复位、
     * 先前落库的模型再也回不来。
     */
    @Autowired
    public WorkspaceDirectory(ProjectDirectoryStore store) {
        this.store = store == null ? new NoopProjectDirectoryStore() : store;
        if (this.store.enabled()) {
            List<ProjectDirectoryStore.ProjectRow> rows = this.store.loadAll();
            if (rows.isEmpty()) {
                seedDefaults();
            } else {
                rows.forEach(row -> put(row, false));
            }
        } else {
            seedDefaults();
        }
    }

    /** 内置默认目录；落库模式下首次启动会写入库，之后由库接管。 */
    private void seedDefaults() {
        put(new ProjectDirectoryStore.ProjectRow(CURRENT_PROJECT_ID, "车载动力系统工程模型",
                "SysML 1.6 九图示例 · 需求 → 功能 → 架构追溯", "我", PERSONAL, "编辑中", true), true);
        put(new ProjectDirectoryStore.ProjectRow("project-req", "需求工程样例",
                "需求条目化与满足 / 验证追溯样例", "我", PERSONAL, "可打开", true), true);
        put(new ProjectDirectoryStore.ProjectRow("project-eea", "整车电子电气架构",
                "系统工程组 · 架构基线", "系统工程组", TEAM, "可打开", true), true);
        put(new ProjectDirectoryStore.ProjectRow("project-thermal", "热管理系统模型",
                "动力总成组 · 参数图与约束", "动力总成组", TEAM, "可打开", true), true);
        put(new ProjectDirectoryStore.ProjectRow("project-charge", "充电互操作性基线",
                "系统工程组 · 接口控制", "系统工程组", TEAM, "可打开", true), true);
    }

    private void put(ProjectDirectoryStore.ProjectRow row, boolean persist) {
        CopyOnWriteArrayList<Project> list = projects.computeIfAbsent(row.spaceCode(),
                key -> new CopyOnWriteArrayList<>());
        Project project = new Project(row.id(), row.name(), row.description(), row.owner(),
                LocalDate.now().toString(), row.status(),
                row.id().equals(CURRENT_PROJECT_ID), row.editable(), row.spaceCode());
        list.add(project);
        if (persist && store.enabled()) {
            store.save(row);
        }
    }

    public List<Space> spaces() {
        return spaces;
    }

    public List<Project> projects(String spaceCode) {
        CopyOnWriteArrayList<Project> list = projects.get(spaceCode);
        return list == null ? List.of() : List.copyOf(list);
    }

    public Optional<Project> findProject(String id) {
        if (id == null || id.isBlank()) {
            return Optional.empty();
        }
        return projects.values().stream()
                .flatMap(List::stream)
                .filter(project -> project.id().equals(id))
                .findFirst();
    }

    public Project addProject(String spaceCode, String name, String description) {
        CopyOnWriteArrayList<Project> list = projects.get(spaceCode);
        if (list == null) {
            throw new IllegalArgumentException("未知空间：" + spaceCode);
        }
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty() || trimmed.length() > 80) {
            throw new IllegalArgumentException("项目名称不得为空且不超过 80 字");
        }
        if (list.stream().anyMatch(item -> item.name().equalsIgnoreCase(trimmed))) {
            throw new IllegalArgumentException("该空间下已存在同名项目");
        }
        String id = "project-" + UUID.randomUUID().toString().substring(0, 8);
        String owner = PERSONAL.equals(spaceCode) ? "我" : "系统工程组";
        ProjectDirectoryStore.ProjectRow row = new ProjectDirectoryStore.ProjectRow(
                id, trimmed, description == null ? "" : description.trim(),
                owner, spaceCode, "可打开", true);
        if (store.enabled()) {
            store.save(row);
        }
        Project project = new Project(id, trimmed, row.description(), owner,
                LocalDate.now().toString(), "可打开", false, true, spaceCode);
        list.add(0, project);
        return project;
    }
}
