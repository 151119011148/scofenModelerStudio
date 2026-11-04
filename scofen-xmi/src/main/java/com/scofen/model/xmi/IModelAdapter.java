package com.scofen.model.xmi;

import com.scofen.model.metamodel.ModelSnapshot;

/** 交换层插件接口：只在导入导出时激活，在线内核永远是自有 Repository。 */
public interface IModelAdapter {
    ExchangeFormat format();

    ExchangeBundle exportModel(ModelSnapshot snapshot);

    ModelSnapshot importModel(ExchangeBundle bundle);
}
