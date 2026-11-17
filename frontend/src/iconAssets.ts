/**
 * 华望 M-Design 符号资源映射：类型 / 图 / 关系 code → 静态 SVG 文件名。
 *
 * SVG 原件来自 huawang_code/m-design-client/public/statics/images/sysml/（517 个），
 * 已导入 public/icons/sysml/。成品图标自带深灰描边与规范配色，用于
 * 模型树、工具箱、页签等"图片图标"场景；画布上的符号仍由 shapeGlyphs.tsx
 * 参数化绘制（可随主题换色、随样式编辑），两者语义一致但职责不同。
 *
 * 未命中映射的 code 由 icons.tsx 回退到内联 Glyph，保证零图标缺失。
 */
const SYSML_BASE = `${import.meta.env.BASE_URL}icons/sysml/`

/** 元素类型 code → SysML 符号 SVG 文件名。 */
const TYPE_SVG: Record<string, string> = {
  PACKAGE: 'Package',
  MODEL: 'Model',
  MODEL_LIBRARY: 'Model',
  PROFILE: 'Profile',
  STEREOTYPE: 'Stereotype',
  METACLASS: 'Metaclass',
  REQUIREMENT: 'Requirement',
  TEST_CASE: 'TestCase',
  BLOCK: 'Block',
  VALUE_TYPE: 'ValueType',
  PART: 'PartProperty',
  PORT: 'Port',
  FLOW_PORT: 'FlowPort',
  CONNECTOR: 'Connector',
  CONSTRAINT_BLOCK: 'ConstraintBlock',
  CONSTRAINT_PROPERTY: 'ConstraintProperty',
  CONSTRAINT_PARAMETER: 'ConstraintParameter',
  ACTIVITY: 'Activity',
  ACTION: 'Action',
  CONTROL_NODE: 'DecisionNode',
  OBJECT_NODE: 'ObjectNode',
  ACTIVITY_PARTITION: 'ActivityPartition',
  INTERACTION: 'Interaction',
  LIFELINE: 'Lifeline',
  MESSAGE: 'Message',
  COMBINED_FRAGMENT: 'Interaction',
  STATE_MACHINE: 'StateMachine',
  STATE: 'State',
  TRANSITION: 'Transition',
  PSEUDOSTATE: 'PseudostateInitial',
  USE_CASE: 'UseCase',
  ACTOR: 'Actor',
  COMMENT: 'Comment',
  CLASS: 'Class',
  INTERFACE: 'Interface',
  SIGNAL: 'Signal',
  DATA_TYPE: 'DataType',
  PRIMITIVE_TYPE: 'PrimitiveType',
  ENUMERATION: 'Enumeration',
  ENUMERATION_LITERAL: 'EnumerationLiteral',
  ASSOCIATION_CLASS: 'AssociationClass',
  COMPONENT: 'Component',
  COLLABORATION: 'Collaboration',
  COLLABORATION_USE: 'CollaborationUse',
  INFORMATION_ITEM: 'InformationItem',
  INSTANCE_SPECIFICATION: 'InstanceSpecification',
  OPERATION: 'Operation',
  PARAMETER: 'Parameter',
  RECEPTION: 'Reception',
  DEVICE: 'Component',
  EXECUTION_ENVIRONMENT: 'Component',
  ARTIFACT: 'Artifact',
  DEPLOYMENT_SPECIFICATION: 'Artifact',
  VALUE_PROPERTY: 'ValueProperty',
  REFERENCE_PROPERTY: 'ReferenceProperty',
  FLOW_PROPERTY: 'FlowProperty',
  FLOW_SPECIFICATION: 'FlowSpecification',
  RATIONALE: 'Rationale',
  PROBLEM: 'Problem',
  INITIAL_NODE: 'InitialNode',
  ACTIVITY_FINAL_NODE: 'ActivityFinalNode',
  FLOW_FINAL_NODE: 'FlowFinalNode',
  DECISION_NODE: 'DecisionNode',
  MERGE_NODE: 'MergeNode',
  FORK_NODE: 'ForkNode',
  JOIN_NODE: 'JoinNode',
  DATA_STORE_NODE: 'DataStoreNode',
  CENTRAL_BUFFER_NODE: 'CentralBufferNode',
  ACTIVITY_PARAMETER_NODE: 'ActivityParameterNode',
  STRUCTURED_ACTIVITY_NODE: 'StructuredActivityNode',
  EXPANSION_REGION: 'ExpansionRegion',
  INTERRUPTIBLE_ACTIVITY_REGION: 'InterruptibleActivityRegion',
  VALUE_PIN: 'InputPin',
  ACTION_INPUT_PIN: 'InputPin',
  INTERACTION_USE: 'InteractionUse',
  STATE_INVARIANT: 'StateInvariant',
  CONTINUATION: 'Transition',
  GATE: 'Gate',
  CONSIDER_IGNORE_FRAGMENT: 'Interaction',
  PROTOCOL_STATE_MACHINE: 'StateMachine',
  FINAL_STATE: 'FinalState',
  CONNECTION_POINT_REFERENCE: 'ConnectionPointReference',
  TEMPLATE_SIGNATURE: 'Metaclass',
  REDEFINABLE_TEMPLATE_SIGNATURE: 'Metaclass',
  TEMPLATE_PARAMETER: 'Parameter',
  CLASSIFIER_TEMPLATE_PARAMETER: 'Parameter',
  TEMPLATE_BINDING: 'TemplateBinding',
  TEMPLATE_PARAMETER_SUBSTITUTION: 'Parameter',
  OPAQUE_EXPRESSION: 'OpaqueExpression',
  INSTANCE_VALUE: 'InstanceValue',
  DURATION_OBSERVATION: 'DurationObservation',
  TIME_OBSERVATION: 'TimeObservation',
  DURATION_INTERVAL: 'DurationInterval',
  TIME_INTERVAL: 'TimeInterval',
  INTERVAL_CONSTRAINT: 'Constraint',
  DURATION_CONSTRAINT: 'DurationConstraint',
  TIME_CONSTRAINT: 'TimeConstraint',
  PROPERTY: 'Property',
  SLOT: 'Slot',
  OPAQUE_ACTION: 'OpaqueAction',
  OUTPUT_PIN: 'OutputPin',
  VARIABLE: 'Property',
  EXCEPTION_HANDLER: 'ExceptionHandler',
  MESSAGE_OCCURRENCE_SPECIFICATION: 'MessageOccurrenceSpecification',
  EXECUTION_OCCURRENCE_SPECIFICATION: 'ExecutionOccurrenceSpecification',
  INTERACTION_OPERAND: 'InteractionOperand',
  PART_DECOMPOSITION: 'Interaction',
  INTERACTION_CONSTRAINT: 'InteractionConstraint',
  GENERAL_ORDERING: 'Interaction',
  REGION: 'Region',
  TRIGGER: 'Trigger',
  SIGNAL_EVENT: 'SignalEvent',
  CALL_EVENT: 'CallEvent',
  TIME_EVENT: 'TimeEvent',
  CHANGE_EVENT: 'ChangeEvent',
  ANY_RECEIVE_EVENT: 'AnyReceiveEvent',
}

/** 九大图 code → 图符 SVG 文件名。 */
const DIAGRAM_SVG: Record<string, string> = {
  pkg: 'SysMLPackageDiagram',
  req: 'SysMLRequirementDiagram',
  bdd: 'SysMLBlockDefinitionDiagram',
  ibd: 'SysMLInternalBlockDiagram',
  par: 'SysMLParametricDiagram',
  act: 'SysMLActivityDiagram',
  seq: 'SysMLSequenceDiagram',
  stm: 'SysMLStateMachineDiagram',
  uc: 'SysMLUseCaseDiagram',
}

/** 关系 key（normalizeRelKey 后）→ 关系符号 SVG 文件名。 */
const RELATION_SVG: Record<string, string> = {
  containment: 'Containment',
  import: 'ElementImport',
  access: 'Dependency',
  generalization: 'Generalization',
  association: 'Association',
  dependency: 'Dependency',
  satisfy: 'Satisfy',
  verify: 'Verify',
  refine: 'Refine',
  derivereqt: 'DeriveReqt',
  copy: 'Copy',
  trace: 'Trace',
  allocate: 'Allocate',
  connector: 'Connector',
  itemflow: 'ItemFlow',
  binding: 'BindingConnector',
  delegation: 'Dependency',
  constraintparameter: 'ConstraintParameter',
  controlflow: 'ControlFlow',
  objectflow: 'ObjectFlow',
  partition: 'ActivityPartition',
  message: 'Message',
  include: 'Include',
  extend: 'Extend',
  abstraction: 'Abstraction',
  realization: 'Realization',
  interfacerealization: 'InterfaceRealization',
  substitution: 'Substitution',
  usage: 'Usage',
  packagemerge: 'PackageMerge',
  profileapplication: 'ProfileApplication',
  informationflow: 'InformationFlow',
  manifestation: 'Manifestation',
  transition: 'Transition',
  guard: 'Dependency',
}

/** 拼接静态 SVG 的 URL（含子路径前缀）。 */
export function svgUrl(name: string): string {
  return `${SYSML_BASE}${name}.svg`
}

/** 按元素类型取 SVG 文件名，未命中返回 undefined（调用方回退 Glyph）。 */
export function typeSvgName(code: string): string | undefined {
  return TYPE_SVG[code.toUpperCase()]
}

/** 按图 code 取图符 SVG 文件名。 */
export function diagramSvgName(code: string): string | undefined {
  return DIAGRAM_SVG[code.toLowerCase()]
}

/** 按关系 key 取关系符号 SVG 文件名。 */
export function relationSvgName(key: string): string | undefined {
  return RELATION_SVG[key]
}

/** 只读拷贝，供测试/调试枚举已登记的类型。 */
export const REGISTERED_TYPE_CODES = Object.keys(TYPE_SVG)
