package com.scofen.model.web.persistence;

import com.scofen.model.core.NoopPersistenceService;
import com.scofen.model.core.PersistenceService;

/**
 * 内存模式的持久化工厂：不落库，重启即复位。
 * 返回的实例依然绑定项目 id，以便上层代码在两种模式下写法一致。
 */
public final class NoopPersistenceServiceFactory implements PersistenceServiceFactory {

    @Override
    public boolean enabled() {
        return false;
    }

    @Override
    public PersistenceService forProject(String projectId) {
        return new NoopPersistenceService(projectId);
    }
}
