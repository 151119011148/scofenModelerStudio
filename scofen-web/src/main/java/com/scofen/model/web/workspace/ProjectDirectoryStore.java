package com.scofen.model.web.workspace;

import java.util.List;

/**
 * 项目目录的存储抽象：目录元数据不属于模型四对象，不走 CommandExecutor 与全局 revision，
 * 但持久化模式下必须落库——否则重启后目录复位，先前落库的模型就再也回不来了。
 */
public interface ProjectDirectoryStore {

    /** 是否为落库模式（内存模式为 false，目录仍是进程内状态）。 */
    boolean enabled();

    /** 读取全部项目目录行。 */
    List<ProjectRow> loadAll();

    /** 新增或更新一行目录。 */
    void save(ProjectRow row);

    /** 删除一行目录。 */
    void delete(String projectId);

    /** 目录行：与 {@link WorkspaceDirectory.Project} 对应，但不含 current 标记（那是请求态）。 */
    record ProjectRow(String id, String name, String description, String owner,
                       String spaceCode, String status, boolean editable) {
    }
}
