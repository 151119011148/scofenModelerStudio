package com.scofen.model.core;

import com.scofen.model.metamodel.ModelSnapshot;

import java.util.Optional;

/**
 * 内存模式默认实现：不落库。服务重启后模型回到初始种子态，
 * 与 M0 骨架行为一致；写穿调用全部无操作，不影响热路径与 WS 广播。
 */
public final class NoopPersistenceService implements PersistenceService {

    @Override
    public boolean isEnabled() {
        return false;
    }

    @Override
    public Optional<ModelSnapshot> loadLatest() {
        return Optional.empty();
    }

    @Override
    public void save(ModelSnapshot snapshot) {
        // 内存模式：不做任何持久化
    }
}
