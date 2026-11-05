package com.scofen.model.web.workspace;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 个人空间 / 团队空间下的项目目录（M0）。
 *
 * <p>目录元数据不属于模型四对象（Element / Relationship / Diagram / Notation），
 * 因此不走 CommandExecutor 与全局 revision；项目统计由
 * {@code WorkspaceController} 从对应项目的模型快照实时取出。</p>
 *
 * <p>每个项目都可以打开，打开后由 ProjectRegistry 分配独立的内存态模型运行时；
 * 所有项目共用同一套元模型与校验规则。</p>
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

    public WorkspaceDirectory() {
        projects.put(PERSONAL, new CopyOnWriteArrayList<>(List.of(
                new Project(CURRENT_PROJECT_ID, "车载动力系统工程模型",
                        "SysML 1.6 九图示例 · 需求 → 功能 → 架构追溯", "我",
                        LocalDate.now().toString(), "编辑中", true, true, PERSONAL),
                new Project("project-req", "需求工程样例",
                        "需求条目化与满足 / 验证追溯样例", "我", "2026-11-03",
                        "可打开", false, true, PERSONAL))));
        projects.put(TEAM, new CopyOnWriteArrayList<>(List.of(
                new Project("project-eea", "整车电子电气架构",
                        "系统工程组 · 架构基线", "系统工程组", "2026-11-04",
                        "可打开", false, true, TEAM),
                new Project("project-thermal", "热管理系统模型",
                        "动力总成组 · 参数图与约束", "动力总成组", "2026-11-01",
                        "可打开", false, true, TEAM),
                new Project("project-charge", "充电互操作性基线",
                        "系统工程组 · 接口控制", "系统工程组", "2026-10-28",
                        "可打开", false, true, TEAM))));
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
        Project project = new Project(
                "project-" + UUID.randomUUID().toString().substring(0, 8),
                trimmed,
                description == null ? "" : description.trim(),
                PERSONAL.equals(spaceCode) ? "我" : "系统工程组",
                LocalDate.now().toString(), "可打开", false, true, spaceCode);
        list.add(0, project);
        return project;
    }
}
