package com.scofen.model.web.persistence;

import com.scofen.model.core.PersistenceService;

/**
 * 持久化实例工厂：按项目 id 产出绑定了该项目的 {@link PersistenceService}。
 *
 * <p>运行时是「每项目独立 Repository」，持久化必须与之一一对应；
 * 工厂是唯一能同时持有 DataSource 与项目语义的装配点。</p>
 */
public interface PersistenceServiceFactory {

    /** 是否为落库模式（内存模式为 false）。 */
    boolean enabled();

    /** 取得绑定到指定项目的持久化实例。 */
    PersistenceService forProject(String projectId);
}
