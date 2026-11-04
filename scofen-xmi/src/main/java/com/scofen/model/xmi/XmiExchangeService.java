package com.scofen.model.xmi;

import com.scofen.model.metamodel.DiagramKind;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

/**
 * 交换层入口。M0 固化「语义层 / 图层分离」契约与格式矩阵；
 * EMF UML2 + SysML 1.6 Profile 的 UmlXmiAdapter 在 M3 接入，本接口不变。
 */
public final class XmiExchangeService {

    private final Map<ExchangeFormat, IModelAdapter> adapters = new EnumMap<>(ExchangeFormat.class);

    public XmiExchangeService(IModelAdapter... available) {
        for (IModelAdapter adapter : available) {
            adapters.put(adapter.format(), adapter);
        }
    }

    public Set<ExchangeFormat> supportedFormats() {
        return Set.copyOf(adapters.keySet());
    }

    public boolean hasAdapter(ExchangeFormat format) {
        return adapters.containsKey(format);
    }

    public IModelAdapter requireAdapter(ExchangeFormat format) {
        IModelAdapter adapter = adapters.get(format);
        if (adapter == null) {
            throw new ExchangeException("No adapter registered for " + format.label());
        }
        return adapter;
    }

    /** 标准 XMI 不承载图类型 / 图名 / 坐标，缺少侧车时九图会塌成一个点。 */
    public void validateImport(ExchangeBundle bundle) {
        if (bundle == null || bundle.semantic() == null || bundle.semantic().isBlank()) {
            throw new ExchangeException("Missing semantic payload");
        }
        if (!bundle.format().carriesNotation() && isBlank(bundle.notationSidecar())) {
            throw new ExchangeException("Standard XMI carries semantics only: a .di.json sidecar "
                    + "or server-side relayout is required for the nine diagrams");
        }
    }

    /** 自有 .scofen.json 与侧车方案必须完整保留九图布局。 */
    public void assertNineDiagramLayout(ExchangeBundle bundle) {
        if (bundle.diagramKinds().size() != DiagramKind.values().length) {
            throw new ExchangeException("Expected 9 diagram layouts, got " + bundle.diagramKinds().size());
        }
        for (DiagramKind kind : DiagramKind.values()) {
            if (!bundle.diagramKinds().contains(kind)) {
                throw new ExchangeException("Missing layout for " + kind.label());
            }
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
