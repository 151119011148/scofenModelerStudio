package com.scofen.model.metamodel;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 一张图的「有效规范」：规范图基底 ∩ 用户自定义图类型声明的白名单。
 *
 * <p>MagicDraw / M-Design 的自定义图并不是另起一套渲染内核，而是「以某张规范图为底，
 * 限定它允许出现的元素与关系」。本类把这条语义做成纯函数，服务端校验与前端目录
 * 共用同一份结果，避免界面给出能画但服务端拒绝的组件。</p>
 *
 * <p>定义元素（{@link ElementType#DIAGRAM_TYPE}）不存在、基底非法或白名单为空时，
 * 一律退回基底规范——脏定义不会让一张图变成「什么都画不了」。</p>
 */
public record EffectiveDiagramSpec(
        String code,
        String label,
        String labelEn,
        DiagramKind baseKind,
        String layout,
        String validationGroup,
        Set<ElementType> elements,
        Set<RelationshipType> relationships,
        String customTypeId) {

    public EffectiveDiagramSpec {
        elements = Set.copyOf(elements);
        relationships = Set.copyOf(relationships);
    }

    public boolean allows(ElementType type) {
        return elements.contains(type);
    }

    public boolean allows(RelationshipType type) {
        return relationships.contains(type);
    }

    public boolean custom() {
        return customTypeId != null;
    }

    /**
     * 从 Diagram 计算有效规范。
     *
     * @param diagram  图
     * @param lookup   按 id 找定义元素；找不到返回 empty
     */
    public static EffectiveDiagramSpec of(Diagram diagram,
                                           java.util.function.Function<String, Optional<ModelElement>> lookup) {
        DiagramKind base = diagram.kind();
        MetamodelRegistry.DiagramSpec spec = MetamodelRegistry.spec(base);
        String customId = diagram.customTypeId();
        if (customId == null) {
            return plain(base, spec);
        }
        Optional<ModelElement> found = lookup.apply(customId);
        if (found.isEmpty() || ElementType.fromAny(found.get().type()).orElse(null) != ElementType.DIAGRAM_TYPE) {
            return plain(base, spec);
        }
        ModelElement definition = found.get();
        // 定义可以把基底换成另一张规范图（例如以 BDD 为底做「接口图」）。
        DiagramKind effectiveBase = base;
        String override = str(definition, Customization.DIAGRAM_BASE_KIND);
        if (!override.isBlank()) {
            try {
                effectiveBase = DiagramKind.fromCode(override);
            } catch (RuntimeException ignored) {
                // 非法基底退回图自身的 kind。
            }
        }
        MetamodelRegistry.DiagramSpec effectiveSpec = MetamodelRegistry.spec(effectiveBase);

        Set<ElementType> elements = intersect(effectiveSpec.elements(),
                Customization.stringList(definition.properties().get(Customization.DIAGRAM_ALLOWED_TYPES)));
        Set<RelationshipType> relationships = intersectRel(effectiveSpec.relationships(),
                Customization.stringList(definition.properties()
                        .get(Customization.DIAGRAM_ALLOWED_RELATIONSHIPS)));
        if (elements.isEmpty()) {
            elements = effectiveSpec.elements();
        }
        if (relationships.isEmpty()) {
            relationships = effectiveSpec.relationships();
        }
        String label = definition.name();
        String labelEn = str(definition, Customization.DIAGRAM_LABEL_EN);
        if (labelEn.isBlank()) {
            labelEn = effectiveBase.labelEn();
        }
        return new EffectiveDiagramSpec(customId, label, labelEn, effectiveBase,
                effectiveSpec.layout(), effectiveSpec.validationGroup(),
                elements, relationships, customId);
    }

    private static EffectiveDiagramSpec plain(DiagramKind base, MetamodelRegistry.DiagramSpec spec) {
        return new EffectiveDiagramSpec(base.code(), base.label(), base.labelEn(), base,
                spec.layout(), spec.validationGroup(), spec.elements(), spec.relationships(), null);
    }

    private static Set<ElementType> intersect(Set<ElementType> base, List<String> allowed) {
        Set<ElementType> result = new LinkedHashSet<>();
        for (String code : allowed) {
            ElementType.fromAny(code).filter(base::contains).ifPresent(result::add);
        }
        return result;
    }

    private static Set<RelationshipType> intersectRel(Set<RelationshipType> base, List<String> allowed) {
        Set<RelationshipType> result = new LinkedHashSet<>();
        for (String code : allowed) {
            RelationshipType.fromAny(code).filter(base::contains).ifPresent(result::add);
        }
        return result;
    }

    private static String str(ModelElement element, String key) {
        Object value = element.properties().get(key);
        return value == null ? "" : String.valueOf(value);
    }

    /** 图框标题：自定义模板优先，占位符替换；未定义走规范三段式调用方自己拼。 */
    public static String frameTitleTemplate(ModelElement definition) {
        if (definition == null) {
            return "";
        }
        Object value = definition.properties().get(Customization.DIAGRAM_FRAME_TITLE);
        return value == null ? "" : String.valueOf(value);
    }
}
