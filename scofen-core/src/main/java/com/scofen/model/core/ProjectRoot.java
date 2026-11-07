package com.scofen.model.core;

import com.scofen.model.metamodel.ElementType;
import com.scofen.model.metamodel.ExtensionLibrary;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.PropertyCatalog;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目根的单一定义。
 *
 * <p>每个项目有且只有一个<b>顶层元素</b>，固定为 {@link ElementType#PACKAGE}。
 * 之所以用 Package 而不是 Model：UML/SysML 里 Model 是 Package 的一种，项目根承担
 * 「项目容器」的职责，其下才是一个或多个真正的项目模型（Model）。若根本身就是 Model，
 * 「项目只能有一个根 Model」的限制会占住名额，用户无法再组织模型节点。</p>
 *
 * <p>id 沿用 {@code model-root} 这个历史命名：图、关系、通用扩展包的 ownerId 都指向它，
 * 改名会让存量快照与导入文件全部失配，收益为零。名字只是名字，语义以此类为准。</p>
 */
public final class ProjectRoot {

    public static final String ID = "model-root";
    public static final ElementType TYPE = ElementType.PACKAGE;
    /**
     * 落库与 XMI 里用的类型码。必须是 {@code umlName}（"Package"）而不是枚举名
     * （"PACKAGE"）：全系统的类型映射表按 umlName 匹配，写成大写会让 XMI 把根
     * 导成 {@code uml:Class}。
     */
    public static final String TYPE_CODE = TYPE.umlName();

    private ProjectRoot() {
    }

    /** 项目根＝顶层（ownerId 为空）元素。按位置判定，不按类型，天然兼容存量数据。 */
    public static boolean isRoot(ModelElement element) {
        return element != null && (element.ownerId() == null || element.ownerId().isBlank());
    }

    /**
     * 把任意顶层元素归一成项目根 Package：类型与「扩展的元类」引用一起改，
     * 其余字段（名称、文档、标签值、xmiId、其它属性）原样保留。
     * 用于导入外部 XMI（根常是 {@code uml:Model}）与老快照回载。
     */
    public static ModelElement coerce(ModelElement root) {
        if (TYPE_CODE.equals(root.type())) {
            return root;
        }
        Map<String, Object> properties = new LinkedHashMap<>(root.properties());
        properties.put("extendsMetaclass",
                ExtensionLibrary.metaclassId(PropertyCatalog.rootMetaclass(TYPE)));
        return new ModelElement(root.id(), TYPE_CODE, root.name(), root.stereotypes(),
                root.ownerId(), root.documentation(), root.taggedValues(), root.xmiId(),
                Map.copyOf(properties));
    }

    /**
     * 存量项目迁移：老版本把项目根播种成 Model，这里在快照回载后就地归一为 Package。
     * 不产生 revision、不广播 Patch —— 这是数据格式迁移，不是用户编辑。
     *
     * @return 是否真的改动了数据（调用方据此决定要不要重写一次快照）
     */
    public static boolean normalize(InMemoryModelRepository repository) {
        ModelSnapshot snapshot = repository.snapshot();
        ModelSnapshot normalized = normalize(snapshot);
        if (normalized == snapshot) {
            return false;
        }
        // load 保留 revision，且是原子替换；不会与正在进行的 apply 交错。
        repository.load(normalized);
        return true;
    }

    /**
     * 快照版归一，供导入流水线在发命令前使用。
     *
     * <p>只动第一个顶层元素（项目根）：外部 XMI 可能还有别的顶层 Package / Profile，
     * 它们是用户模型的一部分，不该被「项目根约定」改写。</p>
     */
    public static ModelSnapshot normalize(ModelSnapshot snapshot) {
        List<ModelElement> normalized = new ArrayList<>(snapshot.elements().size());
        boolean rootHandled = false;
        boolean changed = false;
        for (ModelElement element : snapshot.elements()) {
            if (!rootHandled && isRoot(element)) {
                rootHandled = true;
                if (!TYPE_CODE.equals(element.type())) {
                    normalized.add(coerce(element));
                    changed = true;
                    continue;
                }
            }
            normalized.add(element);
        }
        return changed
                ? new ModelSnapshot(snapshot.revision(), normalized, snapshot.relationships(),
                        snapshot.diagrams(), snapshot.notations())
                : snapshot;
    }
}
