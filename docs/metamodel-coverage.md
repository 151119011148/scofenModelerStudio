# 元模型覆盖审计 · 2026-11-07

> 结论先说：**元类的「深度」够，可建类型的「广度」不够。**
> 元模型里有 158 个规范元类、451 条元属性定义，但用户能点「新建」的元素类型只有 **33** 个，
> 另外 **104 个元类没有任何入口**（没有对应的 `ElementType`，属性面板永远渲染不到）——
> 其中 `Operation` / `Interface` / `Signal` / `Node` / `Artifact` / `Enumeration` 的属性表**已经写好却用不上**。
> 你感觉「枚举 / String 值类型少」不是错觉，是三条链路同时断了：建不出 → 没有库 → 引不到。

---

## 1. 现状盘点（全部可从线上接口复核）

| 维度 | 数量 | 事实来源 |
| --- | --- | --- |
| 可建元素类型 `ElementType` | **33** | `GET /api/metamodel/containment` → `types[]` |
| 元类 `UmlMetaclass` | **160**（158 规范 + 2 实现层 `SCOFEN_CORE` / `SCOFEN_RELATION`） | `UmlMetaclass.java` |
| 元属性定义 | **451** 条 | `GET /api/metamodel/properties` → `totalDefinitions` |
| 关系类型 `RelationshipType` | **28** | `GET /api/metamodel/relationships` |
| 扩展包 | **2** 个 Profile + 4 个子包（197 个元素） | `GET /api/metamodel/extension` |
| └ SysML 扩展包 | 元类 **21** / 构造型 **25** | 同上 |
| └ UML 扩展包 | 元类 **137** / 构造型 **8** | 同上 |
| 能通过 33 个 `ElementType` 继承链到达的元类 | **54**（另 2 个是实现层的属性分组） | 属性接口的 `metaclassName` 去重 |
| **没有任何入口的元类** | **104**（158 − 54 可达） | 上两行相减 |

### 九图各能建几个类型（这才是体感来源）

| 图 | 允许元素类型 | 数量 |
| --- | --- | --- |
| 包图 pkg | Package / Model / ModelLibrary / Profile / Stereotype / Metaclass / Comment | 7 |
| 需求图 req | Requirement / TestCase / Block / Comment | 4 |
| 模块定义图 bdd | **Block / ValueType / Package / ConstraintBlock / Comment** | 5 |
| 内部块图 ibd | Part / Port / FlowPort / Connector / Comment | 5 |
| 参数图 par | ConstraintBlock / ConstraintProperty / ConstraintParameter / ValueType / Part | 5 |
| 活动图 act | Activity / Action / ControlNode / ObjectNode / ActivityPartition | 5 |
| 序列图 seq | Interaction / Lifeline / Message / CombinedFragment | 4 |
| 状态机图 stm | StateMachine / State / Transition / Pseudostate | 4 |
| 用例图 uc | UseCase / Actor / Package | 3 |

BDD 里连**枚举、接口、信号、DataType、普通 Class、值属性**都建不出来——这是最该补的一层。

---

## 2. P0 硬缺口：值类型与枚举（你指出的那条）

### 2.1 三条链路同时断

| 环节 | 现状 | 后果 |
| --- | --- | --- |
| ① 建得出吗 | `ElementType` 里没有 `ENUMERATION` / `ENUMERATION_LITERAL` / `DATA_TYPE` / `PRIMITIVE_TYPE` | 枚举元素根本创建不了；`UmlMetaclass.ENUMERATION` 与其 `ownedLiteral` 属性表成了死代码 |
| ② 有库吗 | 扩展包只有 SysML / UML 两个 Profile，**没有 PrimitiveTypes / PrimitiveValueTypes / 单位库** | `String` `Integer` `Boolean` `Real` `UnlimitedNatural` 在模型里不存在 |
| ③ 引用得到吗 | `type` 是 `REFERENCE`，`ValidationEngine.assertReferenceExists()` 要求目标必须存在 | 值属性的类型**只能指向模型里已有的元素**，写 `String` 会被服务端拒（400） |

补充两条同源问题：

- `ContainmentRules` 里 `VALUE_TYPE` 只允许挂 `COMMENT`，**枚举字面量没有任何容器**（即使加了枚举类型也挂不上字面量）。
- 元属性里的枚举值（`visibility` / `concurrency` / `aggregation` …）是硬编码在 `PropertyCatalog` 的 `options` 字符串里，**没有可复用的「枚举类型」目录**，所以用户在模型里造不了自己的枚举。

### 2.2 值属性 / 引用属性 / 流属性也没有入口

| 元类 | 有属性表 | 有 `ElementType` | 现象 |
| --- | --- | --- | --- |
| `SYSML_VALUE_PROPERTY`（值属性） | ✅ | ❌ | **BDD 上建不出值属性**，Block 里只能挂 Part / Port / Connector |
| `SYSML_REFERENCE_PROPERTY`（引用属性） | ✅ | ❌ | 同上 |
| `SYSML_FLOW_PROPERTY`（流属性） | ✅ | ❌ | **IBD 上建不出流属性**，`ItemFlow` 的 `itemProperty` 无处可指 |
| `SYSML_PART_PROPERTY` | ✅ | ✅ `PART` | 只有这一个能用 |

SysML 里「块的值属性」是最常用的元素之一，现在只能靠属性面板的 `ownedAttribute` 引用去挂，没有独立元素可建。这一条建议并进 P0（成本很低：三个 `ElementType` + 包含规则 + `ROOTS`）。

### 2.3 属性表其实已经写好了，只差入口

`PropertyCatalog` 里这些元类的属性定义都在，只是没有 `ElementType` 把它们带出来：

| 元类 | 已定义的属性（节选） | 有入口吗 |
| --- | --- | --- |
| `Enumeration` | `ownedLiteral` | ❌ |
| `EnumerationLiteral` | `/enumeration` | ❌ |
| `PrimitiveType` | （无自身属性，随 DataType） | ❌ |
| `DataType` | `ownedAttribute` / `ownedOperation` | 仅经 SysML `ValueType` 间接可见 |
| `Operation` | 参数、返回类型、并发性、抽象性等 | ❌ |
| `Interface` | 重定义的属性/接收 | ❌ |
| `Signal` | `ownedAttribute` | ❌ |
| `Property`（值/引用/流属性） | 完整（含 `aggregation`/`isComposite`/`type`/多重性） | 仅 Part / Port / ConstraintProperty 三个子类有入口 |
| `Node` / `Artifact` / `Component` | 部署目标、manifestation 等 | ❌ |
| `Association` / `Dependency` / `Realization` | 端点、客户/供应商 | 只有「关系」形式，没有元素形式 |

> 也就是说：**改 4 个地方就能把「枚举 + String」打通**（见 §7），不需要重写属性体系。

---

## 3. P1 缺口：UML 2.5.1 元类（按章节）

只列规范里确实存在、当前 `UmlMetaclass` 未收录的。✅ = 已有。

| 章节 | 缺口 | 影响 |
| --- | --- | --- |
| §7 模板 | `TemplateBinding`、`TemplateParameterSubstitution`、`RedefinableTemplateSignature`、`ClassifierTemplateParameter` | 泛型/参数化类型无法表达（`TemplateSignature`/`TemplateParameter` 已有） |
| §8 值 | `DurationObservation`、`TimeObservation`、`DurationInterval`、`TimeInterval`、`DurationConstraint`、`TimeConstraint`、`IntervalConstraint` | 时序约束、性能指标建模 |
| §9 / §11 分类与结构化 | `AssociationClass`、`InterfaceRealization`、`ComponentRealization`、`InformationItem`、`InformationFlow` | 接口实现、组件实现、信息流（SysML ItemFlow 的 UML 基类） |
| §13 行为 | `AnyReceiveEvent` | 通配接收 |
| §14 状态机 | `ProtocolStateMachine`、`ProtocolConformance` | 协议状态机（接口生命周期） |
| §15 活动 | `InitialNode`、`ActivityFinalNode`、`FlowFinalNode`、`DecisionNode`、`MergeNode`、`ForkNode`、`JoinNode`、`ExpansionRegion`、`InterruptibleActivityRegion`、`StructuredActivityNode`、`ValuePin`、`ActionInputPin` | 现在只有一个通用 `CONTROL_NODE`，图上分不出开始/判断/分叉/汇合 |
| §16 动作 | **40+ 个具体动作全缺**（只抽象 `Action`）：CallBehaviorAction、CallOperationAction、SendSignalAction、SendObjectAction、AcceptEventAction、ReplyAction、CreateObjectAction、DestroyObjectAction、Read/WriteStructuralFeatureAction、Add/RemoveStructuralFeatureValueAction、ClearStructuralFeatureAction、Read/WriteVariableAction、Create/Destroy/ReadLinkAction、ReadExtentAction、ReclassifyObjectAction、ReduceAction、RaiseExceptionAction、UnmarshallAction、TestIdentityAction、ValueSpecificationAction、ClearAssociationAction、StartClassifierBehaviorAction… | 活动图只能画「无名动作」；这一章是规范里最大的洞，MBSE 前 20% 可暂缓 |
| §17 交互 | `Continuation`、`DestructionOccurrenceSpecification`、`ActionExecutionSpecification`、`BehaviorExecutionSpecification`、`ExecutionOccurrenceSpecification`、`ConsiderIgnoreFragment`、`InteractionConstraint`、`PartDecomposition` | 序列图的细节表达 |
| §19 部署 | `DeploymentSpecification`、`CommunicationPath`、`Device`、`ExecutionEnvironment`、`Manifestation` | 部署图（九图里还没有部署图） |
| 用例 / 包 | 齐（Include / Extend / ExtensionPoint / PackageImport / PackageMerge / ProfileApplication / Extension / ExtensionEnd 都在） | — |

---

## 4. P1 缺口：SysML 1.6 构造型（21 → 应有 ~50）

现有 21 个：Block、ConstraintBlock、ValueType、Unit、Dimension、Requirement、TestCase、PartProperty、ValueProperty、ReferenceProperty、ConstraintProperty、ConstraintParameter、FlowPort、FlowSpecification、FlowProperty、ItemFlow、Allocate、View、Viewpoint、Rationale、Problem。

缺失（按用途分组）：

| 组 | 缺失构造型 |
| --- | --- |
| 需求 / 追溯 | `Conform`、`Expose`、`Stakeholder`、`ElementGroup`、`ElementPropertyPath`、`DirectedRelationshipPropertyPath` |
| 属性 / 端口 | `AdjunctProperty`、`ParticipantProperty`、`ConnectorProperty`、`DistributedProperty`、`BoundReference`、`NestedConnectorEnd`、`ProxyPort`、`FullPort`、`InterfaceBlock`、`PropertySpecificType`、`ClassifierBehaviorProperty`、`EndPathMultiplicity`、`InvocationOnNestedPortAction`、`TriggerOnNestedPort` |
| 量化 / 流 | `Rate`、`Continuous`、`Discrete`、`NoBuffer`、`Overwrite`、`Optional`、`Probability` |
| 行为 | `ControlOperator`、`ChangeStructuralFeatureEvent`、`AcceptChangeStructuralFeatureEventAction`、`AllocateActivityPartition`、`BindingConnector` |
| SysML 枚举类型 | `ControlValueKind`、`FeatureDirectionKind`、`VerdictKind` |
| 值类型库 | `PrimitiveValueTypes::{Boolean, Integer, Real, String, Number, Complex}`（`Complex` 带 `realPart`/`imaginaryPart`） |

> 说明：`Copy` / `DeriveReqt` / `Refine` / `Satisfy` / `Trace` / `Verify` 在本产品里是**一等关系对象**（`RelationshipType`），不是缺；但扩展包的「构造型」清单里没有它们的对应元素，两边语义没有互链。

---

## 5. 你问的「是否少了扩展包」——**少了 4 类**

现在只有 `SysML 扩展包` 与 `UML 扩展包`，各含「元类 / 构造型」两个子包。缺：

| # | 缺的扩展包 | 内容 | 为什么必须先补 |
| --- | --- | --- | --- |
| 1 | **UML PrimitiveTypes** | `PrimitiveType` × 5：Boolean / Integer / Real / String / UnlimitedNatural | **「String 值类型」缺失的直接原因**；`type` 引用需要真实元素 |
| 2 | **SysML PrimitiveValueTypes** | `ValueType` × 6：Boolean / Integer / Real / String / Number / Complex（含 realPart、imaginaryPart） | SysML 明确要求值属性用 SysML 值类型而非 UML 原始类型 |
| 3 | **ISO 80000 / QUDV 单位库** | `Unit` / `Dimension` / `QuantityKind` 实例：metre、kilogram、second、ampere、kelvin、mole、candela 及派生单位 | `ValueType` 的 `unit` / `quantityKind` 现在无处可指，量纲建模是空转 |
| 4 | **UML StandardProfile L2 / L3** | «entity» «control» «boundary» «create» «destroy» «trace» «refine» «auxiliary» «focus» «framework» «metaclass» «powertype» «process» «service» «specification» «subsystem» «utility» «call» «send» «receive» «implementationClass» «instantiate» «responsibility» «file» «document» «source» «executable» «library» «table» «view» «buildComponent» «derive» «realize» «use» «access» «import» «permit» «merge» | 团队协作建模的事实标准，和 Cameo 对齐需要 |

另外两个结构性问题（不是「少」，是「层级不对」）：

- 扩展包把**抽象元类也物化成了元素**：`Element`、`Namespace`、`Feature`、`Action`、`ActivityNode`… 约 40 个不可实例化的元类，和可建元类平铺在同一层，且**没有「抽象」标记**。用户浏览扩展包想找「能建什么」时会被这些干扰。
- `ElementType` 的 `stereotype` 字段被当成「每个类型的默认构造型」，导致 `package` / `model` / `profile` / `comment` / `metaclass` / `controlNode` 等 25 个**自造关键词**也进了扩展包构造型清单；规范的 UML 并没有这些构造型。建议区分「规范构造型」与「界面默认关键词」。

---

## 6. 缺口：关系类型（28 个）

缺的（UML 规范有、当前 `RelationshipType` 无）：

| 关系 | 用途 | 优先级 |
| --- | --- | --- |
| `interfaceRealization` | 类/组件实现接口 | P1（有 Interface 才需要） |
| `realization` / `abstraction` | 设计元素实现/抽象到实现层 | P1 |
| `substitution` | 组件替换（设计件 ↔ 实现件） | P2 |
| `usage` | 使用依赖（比 dependency 更具体） | P2 |
| `packageMerge` | 包合并（Profile 组合必需） | P1（做 Profile 机制时） |
| `profileApplication` | 应用剖面 | P2 |
| `informationFlow` | 信息流 | P2 |
| `manifestation` | 工件体现组件 | P2（做部署图时） |

---

## 7. 补齐方案（按投入产出排序）

### P0 · 半天：把「枚举 + 值类型」打通

| 改动 | 文件 | 要点 |
| --- | --- | --- |
| +4 个元素类型 | `ElementType.java` | `DATA_TYPE("DataType")`、`PRIMITIVE_TYPE("PrimitiveType")`、`ENUMERATION("Enumeration")`、`ENUMERATION_LITERAL("EnumerationLiteral")`；`stereotype` 留空（不走 SysML 构造型） |
| +3 个属性元素类型 | `ElementType.java` | `VALUE_PROPERTY("ValueProperty","valueProperty")`、`REFERENCE_PROPERTY("ReferenceProperty","referenceProperty")`、`FLOW_PROPERTY("FlowProperty","flowProperty")`（元类已存在，只差入口） |
| +包含规则 | `ContainmentRules.java` | 加入 `namespace` 集合；`PACKAGE/BLOCK/VALUE_TYPE/DATA_TYPE` 可含 `ENUMERATION`/`DATA_TYPE`/`PRIMITIVE_TYPE`；`ENUMERATION` 可含 `ENUMERATION_LITERAL`；`ENUMERATION_LITERAL` 仅可含 `COMMENT` |
| +主图归属 | `MetamodelRegistry.java` | 四个类型加入 **BDD** 的 `elements`，`primary(...)` 都归 `BDD`；`PRIMITIVE_TYPE` 也可进 PKG |
| +属性链 | `PropertyCatalog.java` | `ROOTS` 里补 `ENUMERATION → [ENUMERATION, DATA_TYPE, …]`、`ENUMERATION_LITERAL → [ENUMERATION_LITERAL, …]`、`DATA_TYPE → [DATA_TYPE, …]`、`PRIMITIVE_TYPE → [PRIMITIVE_TYPE, DATA_TYPE, …]` |
| +值类型库 | `ExtensionLibrary.java` | 新增 `ext-primitive`（Profile/Package）挂 5 个 `PRIMITIVE_TYPE` 元素：Boolean/Integer/Real/String/UnlimitedNatural，**只读**（沿用扩展包不可删的规则） |
| 图标 | `icons.tsx` | 4 个 key（枚举/字面量/数据类型/原始类型） |

> 注意：扩展包元素数会从 **197 → 202**，主示例项目 **218 → 223**；`ExtensionLibraryTest`、`PropertyCatalogTest`、前端徽标文案与 E2E 断言都要同步。

### P1 · 1–2 天：结构建模补全

`Class`、`Interface`、`Signal`、`Operation`、`Parameter`、`ValueProperty`、`ReferenceProperty`、`FlowProperty`、`AssociationClass`、`InstanceSpecification`、`Node`、`Component`、`Artifact`、`Device`、`ExecutionEnvironment`、`DeploymentSpecification` + 关系 `interfaceRealization` / `realization` / `packageMerge`。同时补 SysML `PrimitiveValueTypes` 与 ISO 80000 单位库。

### P2 · 按需：§16 动作层、SysML 剩余构造型、StandardProfile L2/L3、部署图

---

## 8. 附：33 个可建类型现状（按九图归属）

| 归属 | 类型 |
| --- | --- |
| 包图（7） | Package、Model、ModelLibrary、Profile、Stereotype、Metaclass、Comment |
| 需求图（4） | Requirement、TestCase、Block、Comment |
| BDD（5） | Block、ValueType、Package、ConstraintBlock、Comment |
| IBD（5） | PartProperty、Port、FlowPort、Connector、Comment |
| 参数图（5） | ConstraintBlock、ConstraintProperty、ConstraintParameter、ValueType、PartProperty |
| 活动图（5） | Activity、Action、ControlNode、ObjectNode、ActivityPartition |
| 序列图（4） | Interaction、Lifeline、Message、CombinedFragment |
| 状态机图（4） | StateMachine、State、Transition、Pseudostate |
| 用例图（3） | UseCase、Actor、Package |

> 33 个类型里真正「UML 原生」的只有 9 个（Package/Model/ModelLibrary/Profile/Stereotype/Metaclass/Comment/Connector），其余 24 个都是 SysML 构造型语义（Block/Part/Port/Requirement/ValueType…）。所以现在这套目录适合「SysML 快速草模」，不适合「UML 完整建模」。
