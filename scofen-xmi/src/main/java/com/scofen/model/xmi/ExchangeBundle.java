package com.scofen.model.xmi;

import com.scofen.model.metamodel.DiagramKind;

import java.util.List;

/** 一次交换的载荷：语义文件 + 可选布局侧车 + 覆盖的图种类。 */
public record ExchangeBundle(
        ExchangeFormat format,
        String semantic,
        String notationSidecar,
        List<DiagramKind> diagramKinds) {

    public ExchangeBundle {
        diagramKinds = diagramKinds == null ? List.of() : List.copyOf(diagramKinds);
    }
}
