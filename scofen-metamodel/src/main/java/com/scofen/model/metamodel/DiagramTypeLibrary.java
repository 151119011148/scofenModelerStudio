package com.scofen.model.metamodel;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 预置扩展图库：开箱即用的一批「扩展图」（Custom Diagram）模板。
 *
 * <p>对标 MagicDraw / M-Design 的图种类库。二者的共同点是：除了标准图之外，
 * 还随产品附带一批业务向的图模板（系统上下文图、需求分解图、逻辑架构图……），
 * 用户新建图时直接挑，而不是每次都从零勾白名单。</p>
 *
 * <p>本类只提供**清单**（纯数据，不含运行时状态）；真正的定义元素由
 * {@code DiagramTypeSeeder} 写成模型里的一等元素——与用户手建的扩展图完全同构，
 * 可改名、可改白名单、可删除、可撤销、可随快照与 XMI 往返。</p>
 *
 * <p>白名单里的元素类型写 {@link ElementType} 的 uml 名、关系类型写
 * {@link RelationshipType} 的 code；最终生效的白名单是
 * 「基底规范 ∩ 声明白名单」（见 {@link EffectiveDiagramSpec}），因此清单里
 * 写宽一点不会让图越界。</p>
 */
public final class DiagramTypeLibrary {

    /** 预置定义统一放在这个包下，便于用户在模型树里找到并管理。 */
    public static final String LIBRARY_PACKAGE_ID = "e-pkg-diagram-type-library";
    public static final String LIBRARY_PACKAGE_NAME = "扩展图库";

    /** 预置定义元素 id 前缀：落在用户域（{@code e-}），不会被扩展播种器当过期内容清掉。 */
    public static final String PRESET_ID_PREFIX = "e-dt-preset-";

    /**
     * 一条预置扩展图定义。
     *
     * @param id           定义元素 id
     * @param name         中文名（同时是新建图对话框里显示的图种名）
     * @param labelEn      英文名
     * @param baseKind     布局与校验基底：{@link DiagramKind#code()}
     * @param allowedTypes 允许出现的元素类型（uml 名）
     * @param allowedRels  允许出现的关系类型（code）
     * @param documentation 说明
     */
    public record Preset(String id, String name, String labelEn, String baseKind,
                          List<String> allowedTypes, List<String> allowedRels,
                          String documentation) {
        public Preset {
            allowedTypes = List.copyOf(allowedTypes);
            allowedRels = List.copyOf(allowedRels);
        }

        /** 该预置定义的模型属性包（与用户手建的扩展图完全一致）。 */
        public Map<String, Object> properties() {
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put(Customization.DIAGRAM_BASE_KIND, baseKind);
            properties.put(Customization.DIAGRAM_ALLOWED_TYPES, allowedTypes);
            properties.put(Customization.DIAGRAM_ALLOWED_RELATIONSHIPS, allowedRels);
            properties.put(Customization.DIAGRAM_FRAME_TITLE, "{图种}");
            properties.put(Customization.DIAGRAM_LABEL_EN, labelEn);
            return properties;
        }
    }

    private static final List<Preset> PRESETS = List.of(
            new Preset(PRESET_ID_PREFIX + "system-context", "系统上下文图", "System Context Diagram",
                    "bdd",
                    List.of("Block", "Requirement", "Package", "Comment"),
                    List.of("containment", "generalization", "association", "dependency", "satisfy"),
                    "系统与外部参与者、上下级系统之间的关系视图，是 MBSE 建模的起点。"),

            new Preset(PRESET_ID_PREFIX + "system-definition", "系统定义图", "System Definition Diagram",
                    "bdd",
                    List.of("Block", "ValueType", "ConstraintBlock", "Package", "Comment"),
                    List.of("containment", "generalization", "association", "interfaceRealization", "informationFlow"),
                    "系统由哪些块组成、块之间如何连接，SysML 的 SDD 视图。"),

            new Preset(PRESET_ID_PREFIX + "project-context", "项目上下文图", "Project Context Diagram",
                    "pkg",
                    List.of("Package", "Block", "Requirement", "Comment"),
                    List.of("containment", "import", "dependency", "satisfy"),
                    "项目范围与干系人上下文，用于划定建模边界。"),

            new Preset(PRESET_ID_PREFIX + "stakeholder", "利益相关方图", "Stakeholder Diagram",
                    "uc",
                    List.of("Actor", "UseCase", "Package", "Comment"),
                    List.of("association", "include", "extend", "generalization"),
                    "识别干系人及其目标，作为需求来源。"),

            new Preset(PRESET_ID_PREFIX + "requirement-decomposition", "需求分解图", "Requirement Decomposition Diagram",
                    "req",
                    List.of("Requirement", "TestCase", "Package", "Comment"),
                    List.of("deriveReqt", "refine", "copy", "trace", "satisfy", "verify"),
                    "把高层需求逐级分解为可验证的子需求。"),

            new Preset(PRESET_ID_PREFIX + "requirement-trace", "需求追溯图", "Requirement Traceability Diagram",
                    "req",
                    List.of("Requirement", "Block", "Class", "Package", "Comment"),
                    List.of("satisfy", "verify", "trace", "refine", "allocate"),
                    "需求与设计元素之间的双向追溯，支撑覆盖矩阵。"),

            new Preset(PRESET_ID_PREFIX + "functional-decomposition", "功能分解图", "Functional Decomposition Diagram",
                    "bdd",
                    List.of("Block", "Class", "Package", "Comment"),
                    List.of("containment", "generalization", "association", "dependency", "satisfy"),
                    "功能树：系统功能逐层分解到子功能。"),

            new Preset(PRESET_ID_PREFIX + "logical-architecture", "逻辑架构图", "Logical Architecture Diagram",
                    "bdd",
                    List.of("Block", "ValueType", "ConstraintBlock", "Part", "Package", "Comment"),
                    List.of("containment", "generalization", "association", "informationFlow", "satisfy"),
                    "与实现无关的逻辑分层：表现层 / 业务层 / 数据层。"),

            new Preset(PRESET_ID_PREFIX + "physical-architecture", "物理架构图", "Physical Architecture Diagram",
                    "ibd",
                    List.of("Part", "Port", "FlowPort", "Connector", "InformationItem", "Block", "Comment"),
                    List.of("connector", "itemFlow", "delegation", "informationFlow", "binding"),
                    "部署形态下的部件与接口连线。"),

            new Preset(PRESET_ID_PREFIX + "subject-domain", "主题域图", "Subject Domain Diagram",
                    "pkg",
                    List.of("Class", "Package", "Comment"),
                    List.of("containment", "import", "generalization", "association", "dependency"),
                    "业务领域模型：先建模问题域，再映射到系统。"),

            new Preset(PRESET_ID_PREFIX + "information-flow", "信息流图", "Information Flow Diagram",
                    "ibd",
                    List.of("Block", "Part", "Port", "FlowPort", "InformationItem", "Comment"),
                    List.of("informationFlow", "itemFlow", "connector", "delegation"),
                    "数据在部件之间的流动路径与内容。"),

            new Preset(PRESET_ID_PREFIX + "scenario", "场景图", "Scenario Diagram",
                    "uc",
                    List.of("Actor", "UseCase", "Package", "Comment"),
                    List.of("association", "include", "extend", "generalization"),
                    "以用例为中心组织干系人参与的主流程。"),

            new Preset(PRESET_ID_PREFIX + "safety-analysis", "安全分析图", "Safety Analysis Diagram",
                    "req",
                    List.of("Requirement", "Block", "ConstraintBlock", "Package", "Comment"),
                    List.of("satisfy", "verify", "refine", "deriveReqt", "trace", "allocate"),
                    "安全需求的分配与验证链路。"),

            new Preset(PRESET_ID_PREFIX + "parameter-analysis", "参数分析图", "Parameter Analysis Diagram",
                    "par",
                    List.of("ConstraintBlock", "ConstraintProperty", "ConstraintParameter", "ValueType", "Part", "Comment"),
                    List.of("binding", "constraintParameter"),
                    "参数化定义与约束绑定，用于变体分析。"),

            new Preset(PRESET_ID_PREFIX + "state-overview", "状态概览图", "State Overview Diagram",
                    "stm",
                    List.of("StateMachine", "State", "Transition", "Region", "Comment"),
                    List.of("transition", "guard", "region"),
                    "跨多个状态机的状态概览，聚焦关键模式。"),

            new Preset(PRESET_ID_PREFIX + "interaction-overview", "交互概览图", "Interaction Overview Diagram",
                    "seq",
                    List.of("Interaction", "Lifeline", "Message", "Comment"),
                    List.of("message", "guard", "orderedFragment"),
                    "多条交互的概览视图，聚焦接口时序。"));

    /** 全部预置扩展图定义。 */
    public static List<Preset> presets() {
        return PRESETS;
    }

    /**
     * 预置扩展图库占用的元素总数：库包 1 个 + 预置定义若干。
     *
     * <p>供测试与界面提示使用。播种时写入的元素数与此一致，
     * 因此测试可以按库计数断言，而不必硬编码一个会随清单调整而失效的数字。</p>
     */
    public static int size() {
        return PRESETS.size() + 1;
    }

    /** 按 id 取一条预置定义。 */
    public static Preset byId(String id) {
        for (Preset preset : PRESETS) {
            if (preset.id().equals(id)) {
                return preset;
            }
        }
        return null;
    }

    /** 该 id 是否属于预置扩展图定义。 */
    public static boolean isPresetId(String id) {
        return id != null && id.startsWith(PRESET_ID_PREFIX);
    }

    private DiagramTypeLibrary() {
    }
}
