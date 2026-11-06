package com.scofen.model.xmi;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.MetamodelRegistry;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 服务端重排：只吃语义、没有布局侧车时的兜底。
 *
 * <p>标准 XMI 不承载图与坐标，因此从别处导入的模型往往只有语义。
 * 此时不能「没有图就完事」——九图是这个工具的主界面，
 * 用户打开后看到九个空图等于导入失败。</p>
 *
 * <p>重排规则来自元模型注册表的「主图归属」表：每个元素类型归一张图，
 * 再按网格铺开。这样得到的布局不保证和原作者一致，但结构正确、
 * 九图齐全、每个元素都能在自己的图上找到。</p>
 */
public final class ServerRelayout {

    /** 节点默认尺寸，与画布常量一致。 */
    public static final double NODE_WIDTH = 168.0;
    public static final double NODE_HEIGHT = 84.0;

    private static final double GRID_X = 196.0;
    private static final double GRID_Y = 128.0;
    private static final double ORIGIN_X = 36.0;
    private static final double ORIGIN_Y = 36.0;
    /** 画布边界，与服务端校验常量一致：越界的记号前端会把它拉回边角、彼此重叠。 */
    private static final double MAX_X = 480.0;
    private static final double MAX_Y = 340.0;

    private ServerRelayout() {
    }

    /**
     * 按主图归属重排：为九张图各挑出属于它的元素，并铺上默认坐标。
     *
     * @param snapshot 已导入的语义快照（可能没有图与记号）
     * @return 补齐了图与记号的新快照
     */
    public static ModelSnapshot relayout(ModelSnapshot snapshot) {
        if (snapshot.diagrams().size() >= DiagramKind.values().length) {
            // 已有完整九图（带侧车导入的情况）：不动。
            return snapshot;
        }

        // 元素按主图归属分组。
        Map<DiagramKind, List<ModelElement>> grouped = new LinkedHashMap<>();
        for (DiagramKind kind : DiagramKind.values()) {
            grouped.put(kind, new ArrayList<>());
        }
        for (ModelElement element : snapshot.elements()) {
            ElementType type = ElementType.fromAny(element.type()).orElse(null);
            if (type == null) {
                continue;
            }
            DiagramKind kind = MetamodelRegistry.primaryKind(type).orElse(null);
            if (kind == null) {
                continue;
            }
            grouped.get(kind).add(element);
        }

        List<Diagram> diagrams = new ArrayList<>();
        List<Notation> notations = new ArrayList<>();
        for (DiagramKind kind : DiagramKind.values()) {
            List<ModelElement> members = grouped.getOrDefault(kind, List.of());
            String diagramId = "d-" + kind.code();
            List<String> elementIds = members.stream().map(ModelElement::id).toList();
            diagrams.add(new Diagram(diagramId, kind, kind.label(), "", elementIds, List.of()));
            int index = 0;
            for (ModelElement element : members) {
                double x = ORIGIN_X + (index % 3) * GRID_X;
                double y = ORIGIN_Y + (index / 3) * GRID_Y;
                notations.add(new Notation("n-" + diagramId + "-" + element.id(), diagramId, element.id(),
                        Math.min(x, MAX_X), Math.min(y, MAX_Y),
                        NODE_WIDTH, NODE_HEIGHT, Map.of()));
                index++;
            }
        }
        return new ModelSnapshot(snapshot.revision(), snapshot.elements(), snapshot.relationships(),
                diagrams, notations);
    }
}
