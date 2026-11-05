package com.scofen.model.core;

import com.scofen.model.metamodel.ModelSnapshot;

import java.util.Optional;

/**
 * 持久化抽象：服务端权威层（InMemoryModelRepository）仍是热真本 + WS 广播源，
 * 本接口仅负责把整包 {@link ModelSnapshot} 落库 / 回载，协议（Command / revision / inverse）不变。
 *
 * <p>两种实现：{@code memory} 模式用 {@link NoopPersistenceService}（不落库、重启即复位）；
 * {@code mysql} 模式用 JDBC 写穿到 MySQL 8.4，按 (project_id, revision) 整包读写，
 * 满足 §2.4.1「JSON 按 (project_id, revision) 整包读写」约束。</p>
 */
public interface PersistenceService {

    /** 是否启用持久化（内存模式为 false，避免热路径无谓开销）。 */
    boolean isEnabled();

    /** 启动时加载最新一份快照；无数据返回空，调用方据此决定是否走种子流程。 */
    Optional<ModelSnapshot> loadLatest();

    /** 写穿一份完整快照（含最新 revision）。实现需保证幂等（同 revision 覆盖或忽略）。 */
    void save(ModelSnapshot snapshot);

    /** 供 /api/health 展示当前持久化模式。 */
    default String describe() {
        return isEnabled() ? "MySQL 8.4" : "in-memory (M0)";
    }
}
