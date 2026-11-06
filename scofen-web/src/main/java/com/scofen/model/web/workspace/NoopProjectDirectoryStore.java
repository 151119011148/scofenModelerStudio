package com.scofen.model.web.workspace;

import java.util.List;

/**
 * 内存模式的目录存储：不做任何落库，目录只在进程内有效。
 */
public final class NoopProjectDirectoryStore implements ProjectDirectoryStore {

    @Override
    public boolean enabled() {
        return false;
    }

    @Override
    public List<ProjectRow> loadAll() {
        return List.of();
    }

    @Override
    public void save(ProjectRow row) {
        // 内存模式：不做任何持久化
    }

    @Override
    public void delete(String projectId) {
        // 内存模式：不做任何持久化
    }
}
