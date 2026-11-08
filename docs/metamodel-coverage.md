# 元模型覆盖补齐报告 · 2026-11-07

> 本文是 `metamodel-coverage.md`（同日审计）的**执行结果**：审计列出的缺口已按清单全部补齐，
> 并保留原始审计结论作为对照基线。所有数字均可从线上接口复核：
> `GET /api/metamodel/containment`、`/properties`、`/relationships`、`/metamodel/extension`。

---

## 1. 前后对比

| 维度 | 审计时 | 现在 | 复核方式 |
| --- | --- | --- | --- |
| 可建元素类型 `ElementType` | 33 | **157**（核心 89 + 规范扩展 68） | `containment.types[]` 长度；`tier` 字段 |
| 元类 `UmlMetaclass` | 160 | **281**（279 规范 + 2 实现层） | `properties.metaclasses[]` |
| 元属性定义 | 451 | **593** | `properties.totalDefinitions` |
| 关系类型 `RelationshipType` | 28 | **37** | `relationships[]` |
| 扩展包顶层根 | 2（SysML / UML Profile） | **6**（2 Profile + 3 ModelLibrary + 1 标准 Profile） | `extension.elements` 里 `ownerId=model-root` 的节点 |
| 扩展包元素 | 197 | **436** | `extension.elements` 长度 |
| └ 元类元素 | 158 | **279** | 按 `type=METACLASS` 计数 |
| └ 构造型元素 | 33 | **88**（SysML 49 + UML 3 + 标准库 36） | 按 `type=STEREOTYPE` 计数 |
| └ 值类型 / 原始类型 / 枚举 | 0 | **42 / 5 / 3**（+ 9 个枚举字面量） | 值类型库、原始类型库、QUDV 库 |
| 有入口的元类 | 54 | **279**（除 2 个实现层分组外全部可达） | `properties.types[]` 的 `metaclasses` 去重 |
| 可建类型的属性链 | 33 | **157**（每个类型都有 `ROOTS`） | `properties.types` 键数 |

档次划分：`Tier.CORE` 89 个进工具箱主分组，`Tier.ADVANCED` 68 个收进「更多规范类型」折叠组——
能力不减，但工具箱不会被四十余个动作淹掉。档次由服务端随 `typeInfo` 下发，前端不硬编码名单。

---

## 2. §2 P0：值类型与枚举（原「三条链路同时断」）

| 环节 | 补齐内容 | 位置 |
| --- | --- | --- |
| ① 建得出 | 新增 `DataType` / `PrimitiveType` / `Enumeration` / `EnumerationLiteral` / `ValueProperty` / `ReferenceProperty` / `FlowProperty` | `ElementType` |
| ② 有库 | 新增 `ext-primitive`（String / Integer / Real / Boolean / UnlimitedNatural）、`ext-value`（SysML 值类型 6 个 + 3 个枚举共 9 个字面量）、`ext-qudv`（7 量纲 + 7 基本单位 + 22 派生单位） | `ExtensionLibrary` |
| ③ 引得到 | `ValueProperty.type` 可直接指向 `prim-String`，`unit` 指向 `unit-kilogram`，`quantityKind` 指向 `dim-mass`；服务端引用校验照常生效 | `PropertyCatalog` + `ValidationEngine` |
| 包含规则 | `ENUMERATION → ENUMERATION_LITERAL`（此前字面量没有任何容器）、`VALUE_TYPE / DATA_TYPE / BLOCK → VALUE_PROPERTY / REFERENCE_PROPERTY / PROPERTY / OPERATION / TEMPLATE_SIGNATURE` | `ContainmentRules` |
| 属性链 | 157 个类型全部登记 `ROOTS`，属性面板不再空白 | `PropertyCatalog` |

接口级实测（本地实例，命令走真实校验）：

```text
OK   ENUMERATION            E2E 枚举           → 下挂 2 个 ENUMERATION_LITERAL
OK   VALUE_PROPERTY         E2E 质量           → type=prim-Real, unit=unit-kilogram
OK   REFERENCE_PROPERTY     E2E 引用属性        → type 指向自建枚举
FAIL ENUMERATION_LITERAL    owner=Block        → Containment rule violation（符合预期）
```

---

## 3. §3 P1：UML 2.5.1 按章节补齐

| 章节 | 补齐的元类 | 可建类型 | 主图 |
| --- | --- | --- | --- |
| §7 模板 | TemplateSignature / TemplateParameter / TemplateBinding / TemplateParameterSubstitution / RedefinableTemplateSignature / ClassifierTemplateParameter | 6（ADVANCED） | BDD |
| §8 值 | DurationObservation / TimeObservation / DurationInterval / TimeInterval / IntervalConstraint / DurationConstraint / TimeConstraint / OpaqueExpression / InstanceValue | 9（ADVANCED） | PAR |
| §9 / §11 | AssociationClass / InterfaceRealization / ComponentRealization / InformationItem / InformationFlow | AssociationClass、InformationItem 可建；后三者作为一等关系 | BDD |
| §13 行为 | SignalEvent / CallEvent / TimeEvent / ChangeEvent / AnyReceiveEvent / Trigger | 6（ADVANCED） | STM |
| §14 状态机 | ProtocolStateMachine / ProtocolConformance / Region | ProtocolStateMachine、Region 可建 | STM |
| §15 活动 | InitialNode / ActivityFinalNode / FlowFinalNode / DecisionNode / MergeNode / ForkNode / JoinNode / StructuredActivityNode / ExpansionRegion / InterruptibleActivityRegion / ValuePin / ActionInputPin / OutputPin | 13 | ACT |
| §16 动作 | 40 个具体动作 + 通用 Action + **OpaqueAction（此前唯一漏掉的动作）** | 42 | ACT |
| §17 交互 | Continuation / DestructionOccurrenceSpecification / ActionExecutionSpecification / BehaviorExecutionSpecification / ExecutionOccurrenceSpecification / MessageOccurrenceSpecification / InteractionOperand / PartDecomposition / InteractionConstraint / GeneralOrdering / ConsiderIgnoreFragment | 11 | SEQ |
| §19 部署 | DeploymentSpecification / CommunicationPath / Device / ExecutionEnvironment / Manifestation | Device / ExecutionEnvironment / DeploymentSpecification 可建；CommunicationPath、Manifestation 作为关系 | PKG |
| 其它具体元素 | Property / Slot / Variable / ExceptionHandler / OpaqueExpression / InstanceValue | 6（ADVANCED） | BDD / ACT |

---

## 4. §4 SysML 1.6 构造型：21 → 49

剖面里构造型元素从 21 涨到 **49**，分两批落地：

- **有独立元素类型的**（随 `ElementType.specStereotype()` 生成，17 个）：block、constraintBlock、
  valueType、requirement、testCase、partProperty、valueProperty、referenceProperty、
  constraintProperty、constraintParameter、flowPort、flowSpecification、flowProperty、
  proxyPort / fullPort、view / viewpoint、rationale、problem 等。
- **没有独立元素类型的「角色型」构造型**（`SYSML_EXTRA_STEREOTYPES`，32 个）：
  conform、expose、stakeholder、elementGroup、elementPropertyPath、directedRelationshipPropertyPath、
  adjunctProperty、participantProperty、connectorProperty、distributedProperty、boundReference、
  classifierBehaviorProperty、optional、nestedConnectorEnd、proxyPort、fullPort、interfaceBlock、
  propertySpecificType、endPathMultiplicity、invocationOnNestedPortAction、triggerOnNestedPort、
  rate、continuous、discrete、noBuffer、overwrite、probability、controlOperator、
  changeStructuralFeatureEvent、acceptChangeStructuralFeatureEventAction、
  allocateActivityPartition、bindingConnector。
  它们标注的是「已有元素的某种角色」——例如 «proxyPort» 标在 Port 上、«rate» 标在流属性上——
  但仍必须以 Stereotype 元素存在并给出 `extendsMetaclass`，否则用户在剖面里查不到，也引用不到。

`Allocate` / `ItemFlow` / `Unit` / `Dimension` 在规范里是**关系类型或值类型**，不是构造型：
`allocate`、`itemFlow` 已是一等关系（`RelationshipType`），单位与量纲落在 `ext-qudv` 值类型库里。

构造型元素的生成条件从「`stereotype != null`」收紧为 `specStereotype()`：
`package` / `comment` / `controlNode` 这类**界面默认关键词不再冒充规范构造型**。

---

## 5. §5 扩展包：2 → 6 个库，两个结构性问题一并解决

| 根 | 类型 | 内容 |
| --- | --- | --- |
| `ext-sysml` | Profile | 元类 53 + 构造型 49 |
| `ext-uml` | Profile | 元类 226 + 构造型 3 |
| `ext-primitive` | ModelLibrary | 原始类型 5（Boolean / Integer / Real / String / UnlimitedNatural） |
| `ext-value` | ModelLibrary | SysML 值类型 6 + 枚举 3（ControlValueKind / VerdictKind / FeatureDirectionKind）+ 字面量 9 |
| `ext-qudv` | ModelLibrary | 量纲 7 + 基本单位 7 + 派生单位 22 |
| `ext-standard` | Profile | UML 标准构造型 L2/L3，36 个 |

结构性修正：

- **抽象元类不再被当成可建元素**：`UmlMetaclass.abstractMetaclass()` 用显式集合标注
  （`Element` / `Namespace` / `Feature` / `Action` / `ActivityNode` / `ControlNode` 等），
  不能靠「有子元类即抽象」推导——`Class` / `Component` / `Node` / `State` 都有子类但可实例化。
  扩展包的元类元素带 `isAbstract` 属性，界面据此区分「能建什么」。
- **界面关键词与规范构造型分离**：见 §4 的 `specStereotype()`。

存量项目不会自动获得新库，因此新增 `ExtensionSeeder.sync()`：快照回载后按 id 差集补建，
只补不改（用户改过名的元类不动）。**两个回载入口都要调**——主示例项目在
`RepositoryConfiguration.sampleModel()`，其它项目在 `ProjectRegistry.create()`；
漏掉前者时线上主项目升级后仍然看不到 `String`（本报告最初就踩了这个坑，
线上快照 218 元素 → 补齐后 **479** 元素，`prim-String` / `unit-kilogram` / `st-proxyPort` 均已在库）。

### 5.1 反方向：清理旧版本冒充构造型的「界面关键词」

`specStereotype()` 收紧后，新版本不再生成 `st-package` / `st-port` / `st-activity` 这类元素，
但**存量快照里它们仍在**。它们既不在扩展目录里、父包又被前端隔离，于是被当作「孤儿」
直接挂到模型树顶层（截图里项目根下一排小写名的「构造型」就是这批东西）。

`sync()` 因此同时做两件事：删掉「落在扩展域 id 命名空间、但目录已不定义」的元素，再补齐缺失。
`ExtensionLibrary.ownsId()` 用保留前缀（`ext-` / `mc-` / `st-` / `rel-` / `prim-` / `val-` / `unit-` /
`dim-` / `std-`）判定扩展域，用户元素 id 形如 `e-xxx`，不会被误删。

前端另加一层兜底：`projectElements` 除了「目录里没有」还要「不是扩展域 id」才进树。
即使服务端目录与快照暂时不同步，扩展内容也不会漏进项目树。
线上实测 479 → **457** 元素（删的 22 个全是 `action` / `activity` / `comment` / `package` /
`port` / `state` / `transition` / `useCase` 这类界面关键词），构造型回到 **88**（SysML 49 + UML 3 + 标准 36）。
单测 `openingLegacyProjectBackfillsLibrariesAddedByNewerVersions` 锁定该行为。

---

## 6. §6 关系类型：28 → 37

新增 9 条：`interfaceRealization`、`realization`、`abstraction`、`substitution`、`usage`、
`packageMerge`、`profileApplication`、`informationFlow`、`manifestation`。

每条关系既是画布连线，也是**模型对象**：带 name / documentation / stereotypes / properties，
属性表由 `RELATION_CHAINS` 显式链下发（37 类全部有链），前端属性面板与元素共用同一分支。

### 6.1 关系模型进扩展包（关系不再只有属性表）

上一轮补齐了关系的属性链，但扩展包里仍然只有元素类型的元类与构造型：`satisfy` / `deriveReqt` /
`association` 这些关系在模型树上**没有任何条目**，等于「元模型有元素、没有关系」。本轮补齐两层：

1. **关系 → 规范元类**：`RelationshipType` 新增 `metaclass()` / `spec()` / `stereotypeRelationship()`，
   37 类全部映射（`satisfy` / `verify` / `refine` / `deriveReqt` / `copy` / `trace` → `Dependency`，
   `allocate` → `Abstraction`，`itemFlow` → `InformationFlow`，`binding` / `delegation` → `Connector`，
   `association` / `generalization` / `transition` 等本身就是元类）。守卫测试
   `everyRelationshipHasANormativeMetaclass` 逐项断言「有元类 + 有出处 + 属性链含该元类」。
2. **关系 → 扩展包条目**：两个 Profile 下各新增「关系」子包（`ext-sysml-rel` / `ext-uml-rel`），
   37 种关系逐个物化为模型元素：规范里是元类的建 `METACLASS`，是构造型的建 `STEREOTYPE`
   （`«satisfy»` 带 `stereotypes=["stereotype"]`），id 前缀 `rel-`，`extendsMetaclass` 指回
   `mc-*` 元类元素。SysML 侧 9 条（满足 / 验证 / 精化 / 派生需求 / 复制 / 追溯 / 分配 / 项流 / 约束参数），
   UML 侧 28 条。`rel-` 同时进 `ownsId()` 保留前缀与前端扩展域前缀表，存量项目由 `sync()` 增量补建。

`/api/metamodel/relationships` 也补上 `metaclass` / `metaclassName` / `spec` / `stereotypeRelationship`，
界面据此显示「这条关系在规范里归属哪个元类」，而不是只有一个中文名。

顺带修正两处链与元类不一致：`CONTAINMENT` 的链补 `Element`（包含关系也有 ownedComment / owner），
`ITEM_FLOW` 的链补 `InformationFlow`（ItemFlow 本就是 InformationFlow 的构造型）。

---

## 7. 验证

| 层 | 手段 | 结果 |
| --- | --- | --- |
| 单元测试 | `./mvnw -B -ntp test` | **144 项、136 通过**（metamodel 19 / core 57 / xmi 12 / web 56；8 项 Testcontainers 无 Docker 跳过），BUILD SUCCESS |
| 目录守卫 | `MetamodelRegistryTest.everyElementTypeIsFullyRegistered` | 157 个类型逐一断言「有主图归属 + 有属性表 + 有可挂载父类型」 |
| 关系守卫 | `everyRelationshipHasANormativeMetaclass`、`extensionLibraryMaterialisesEveryRelationshipType` | 37 种关系逐一断言「有规范元类 + 属性链含该元类 + 扩展包有对应条目 + 条目类型与 extendsMetaclass 正确」 |
| 层级守卫 | `everyMetaclassIsConnectedToTheHierarchy` | 281 个元类不断链；抽象性按规范显式标注 |
| 接口实测 | 真实命令写入 / 删除（本地实例） | 21 个新增类型全部可建，错误父级一律 400 `validation_rule violation`，无残留 |
| 浏览器 E2E | headless Chrome + CDP | 外壳 30 / 模型树与关系 37 / 属性栏 41，共 **108 项全通过**；本轮另测扩展包「关系」子包展开与 `satisfy` 选中（9 项） |

顺带修掉一个真实缺陷：`POST /api/commands` 载荷缺字段时 `Map.copyOf(null)` 抛 NPE 报 500，
现在归一为空载荷走校验失败（400 `validation_failed`），并加单测锁定。

---

## 8. 仍未做（明确不在本次范围）

- **部署图**：§19 的元类与关系已齐，但九图里还没有独立的部署图类型；要加需要新增 `DiagramKind` 与布局。
- **XMI 映射**：新增类型按 `umlName` 输出，SysML 非标准元类走 `scofen:type` 扩展命名空间；
  与外部工具（Cameo）的往返一致性没有逐类型验证。
- **QUDV 的量纲表达式**：单位库给的是扁平实例（量纲 + 单位 + 换算说明），没有做量纲代数推导。
