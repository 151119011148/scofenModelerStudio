package com.scofen.model.web.workspace;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 个人空间 / 团队空间下的项目目录（M0）。
 *
 * <p>目录元数据不属于模型四对象（Element / Relationship / Diagram / Notation），
 * 因此不走 CommandExecutor 与全局 revision；当前项目的统计信息则由
 * {@code WorkspaceController} 每次请求时实时取自服务端模型快照，避免展示过期数字。</p>
 *
 * <p>M0 只有一个接入服务端模型的可编辑项目；其余为目录项，
 * 界面上明确标注「目录项」，不做假切换。</p>
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
                        "目录项", false, false, PERSONAL))));
        projects.put(TEAM, new CopyOnWriteArrayList<>(List.of(
                new Project("project-eea", "整车电子电气架构",
                        "系统工程组 · 架构基线", "系统工程组", "2026-11-04",
                        "目录项", false, false, TEAM),
                new Project("project-thermal", "热管理系统模型",
                        "动力总成组 · 参数图与约束", "动力总成组", "2026-11-01",
                        "目录项", false, false, TEAM),
                new Project("project-charge", "充电互操作性基线",
                        "系统工程组 · 接口控制", "系统工程组", "2026-10-28",
                        "目录项", false, false, TEAM))));
    }

    public List<Space> spaces() {
        return spaces;
    }

    public List<Project> projects(String spaceCode) {
        CopyOnWriteArrayList<Project> list = projects.get(spaceCode);
        return list == null ? List.of() : List.copyOf(list);
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
                LocalDate.now().toString(), "目录项", false, false, spaceCode);
        list.add(0, project);
        return project;
    }
}
