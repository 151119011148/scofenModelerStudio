package com.scofen.model.xmi;

import com.scofen.model.metamodel.Diagram;
import com.scofen.model.metamodel.DiagramKind;
import com.scofen.model.metamodel.ModelElement;
import com.scofen.model.metamodel.ModelSnapshot;
import com.scofen.model.metamodel.Notation;
import com.scofen.model.metamodel.Relationship;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * UML 2.5.1 XMI 适配器：语义往返 + 布局侧车。
 *
 * <p><b>为什么要扩展命名空间</b>：SysML 的 Block / Requirement / PartProperty / Port /
 * Action / State / Lifeline 等并不是标准 UML 元类，硬塞进 {@code uml:Class} 会丢掉类型，
 * 导回来就还原不出原模型。因此产物是「标准 XMI + {@code scofen:} 扩展命名空间」：
 * 标准工具能打开并看到完整的 UML 结构，本工具也能凭扩展属性无损还原。
 * 这与 Cameo 等工具用私有扩展保存 SysML 语义的做法一致。</p>
 *
 * <p><b>结构约定</b>：
 * <ul>
 *   <li>元素按 ownerId 组织成树，容器元素用 {@code uml:ownedElement} 嵌套；</li>
 *   <li>关系挂在根模型下，用 {@code uml:Association}，
 *       两个 {@code uml:Property} 端点分别标 source / target；</li>
 *   <li>原类型、原构造型、标记值与扩展属性包都存在 {@code scofen:} 元素与属性上；</li>
 *   <li>九图布局不写进 XMI，单独走 {@code .di.json} 侧车。</li>
 * </ul>
 */
public final class UmlXmiAdapter implements IModelAdapter {

    public static final String NS_XMI = "http://www.omg.org/spec/XMI/20131001";
    public static final String NS_UML = "http://www.omg.org/spec/UML/20131001";
    public static final String NS_SCOFEN = "http://scofen.modeler/studio/1.0";

    @Override
    public ExchangeFormat format() {
        return ExchangeFormat.XMI_251;
    }

    /* ---------------- 导出 ---------------- */

    @Override
    public ExchangeBundle exportModel(ModelSnapshot snapshot) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document document = builder.newDocument();

            Element xmi = document.createElementNS(NS_XMI, "xmi:XMI");
            xmi.setAttributeNS(NS_XMI, "xmi:version", "2.5");
            xmi.setAttributeNS(NS_XMI, "xmi:timestamp", "2026-01-01T00:00:00");
            document.appendChild(xmi);

            // 元素树：按 ownerId 建索引，根元素（ownerId 为空）挂到 uml:Model 下。
            Map<String, ModelElement> byId = new LinkedHashMap<>();
            Map<String, List<ModelElement>> children = new LinkedHashMap<>();
            ModelElement root = null;
            for (ModelElement element : snapshot.elements()) {
                byId.put(element.id(), element);
                if (element.ownerId() == null || element.ownerId().isBlank()) {
                    if (root == null) {
                        root = element;
                    }
                    continue;
                }
                children.computeIfAbsent(element.ownerId(), key -> new ArrayList<>()).add(element);
            }

            Element model = document.createElementNS(NS_UML, "uml:Model");
            model.setAttributeNS(NS_XMI, "xmi:id", root == null ? "model-root" : root.id());
            model.setAttribute("name", root == null ? "Model" : root.name());
            if (root != null) {
                writeScofen(document, model, root);
            }
            xmi.appendChild(model);

            if (root != null) {
                for (ModelElement child : children.getOrDefault(root.id(), List.of())) {
                    writeElement(document, model, child, children);
                }
            }
            // 根之外的孤儿元素（ownerId 指向不存在的元素）也导出，避免丢数据。
            for (ModelElement element : snapshot.elements()) {
                if (element == root) {
                    continue;
                }
                String ownerId = element.ownerId();
                boolean orphan = ownerId == null || ownerId.isBlank()
                        || (!byId.containsKey(ownerId) && !children.containsKey(ownerId));
                if (orphan) {
                    writeElement(document, model, element, children);
                }
            }

            // 关系：作为根模型下的 packagedElement。
            for (Relationship relation : snapshot.relationships()) {
                Element association = document.createElementNS(NS_UML, "uml:Association");
                association.setAttributeNS(NS_XMI, "xmi:id", relation.id());
                association.setAttribute("name", relation.name() == null ? relation.type() : relation.name());
                association.setAttributeNS(NS_SCOFEN, "scofen:relationType", relation.type());
                association.setAttributeNS(NS_SCOFEN, "scofen:sourceId", relation.sourceId());
                association.setAttributeNS(NS_SCOFEN, "scofen:targetId", relation.targetId());
                if (relation.ownerId() != null && !relation.ownerId().isBlank()) {
                    association.setAttributeNS(NS_SCOFEN, "scofen:ownerId", relation.ownerId());
                }
                if (relation.documentation() != null && !relation.documentation().isBlank()) {
                    association.setAttributeNS(NS_SCOFEN, "scofen:documentation",
                            relation.documentation());
                }
                appendStringList(document, association, "scofen:stereotypes", relation.stereotypes());
                appendStringMap(document, association, "scofen:taggedValues", relation.taggedValues());
                appendValueMap(document, association, "scofen:properties", relation.properties());
                model.appendChild(association);
            }

            NotationSidecar.Sidecar sidecar = NotationSidecar.of(snapshot.diagrams(), snapshot.notations());
            return new ExchangeBundle(ExchangeFormat.XMI_251, serialize(document),
                    sidecarJson(sidecar),
                    snapshot.diagrams().stream().map(diagram -> diagram.kind()).toList());
        } catch (ParserConfigurationException ex) {
            throw new ExchangeException("导出 XMI 失败", ex);
        }
    }

    private void writeElement(Document document, Element parent, ModelElement element,
                              Map<String, List<ModelElement>> children) {
        Element node = document.createElementNS(NS_UML, "uml:ownedElement");
        node.setAttributeNS(NS_XMI, "xmi:type", umlTypeOf(element.type()));
        node.setAttributeNS(NS_XMI, "xmi:id", element.id());
        node.setAttribute("name", element.name());
        writeScofen(document, node, element);
        parent.appendChild(node);
        for (ModelElement child : children.getOrDefault(element.id(), List.of())) {
            writeElement(document, node, child, children);
        }
    }

    /** 把 Scofen 专有信息写到 scofen 命名空间上。 */
    private void writeScofen(Document document, Element node, ModelElement element) {
        node.setAttributeNS(NS_SCOFEN, "scofen:type", element.type());
        if (element.ownerId() != null && !element.ownerId().isBlank()) {
            node.setAttributeNS(NS_SCOFEN, "scofen:ownerId", element.ownerId());
        }
        if (element.documentation() != null && !element.documentation().isBlank()) {
            node.setAttributeNS(NS_SCOFEN, "scofen:documentation", element.documentation());
        }
        if (element.xmiId() != null && !element.xmiId().isBlank()) {
            node.setAttributeNS(NS_SCOFEN, "scofen:xmiId", element.xmiId());
        }
        appendStringList(document, node, "scofen:stereotypes", element.stereotypes());
        appendStringMap(document, node, "scofen:taggedValues", element.taggedValues());
        appendValueMap(document, node, "scofen:properties", element.properties());
    }

    private void appendStringList(Document document, Element parent, String tag, List<String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        Element holder = document.createElementNS(NS_SCOFEN, tag);
        for (String value : values) {
            Element item = document.createElementNS(NS_SCOFEN, "scofen:value");
            item.setTextContent(value);
            holder.appendChild(item);
        }
        parent.appendChild(holder);
    }

    private void appendStringMap(Document document, Element parent, String tag, Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        Element holder = document.createElementNS(NS_SCOFEN, tag);
        for (Map.Entry<String, String> entry : values.entrySet()) {
            Element item = document.createElementNS(NS_SCOFEN, "scofen:entry");
            item.setAttribute("key", entry.getKey());
            item.setAttribute("value", entry.getValue());
            holder.appendChild(item);
        }
        parent.appendChild(holder);
    }

    /** 扩展属性包：值可能是标量或字符串数组，按形态分别落 attribute 与子元素。 */
    private void appendValueMap(Document document, Element parent, String tag, Map<String, Object> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        Element holder = document.createElementNS(NS_SCOFEN, tag);
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            Element item = document.createElementNS(NS_SCOFEN, "scofen:property");
            item.setAttribute("key", entry.getKey());
            Object value = entry.getValue();
            if (value instanceof List<?> list) {
                for (Object element : list) {
                    Element entryNode = document.createElementNS(NS_SCOFEN, "scofen:value");
                    entryNode.setTextContent(String.valueOf(element));
                    item.appendChild(entryNode);
                }
            } else if (value != null) {
                item.setAttribute("value", String.valueOf(value));
            }
            holder.appendChild(item);
        }
        parent.appendChild(holder);
    }

    /** Scofen 元素类型 → 标准 UML 元素类型（保留原类型在 scofen:type 上）。 */
    static String umlTypeOf(String scofenType) {
        if (scofenType == null) {
            return "uml:Class";
        }
        return switch (scofenType) {
            case "Model" -> "uml:Model";
            case "Package", "ModelLibrary" -> "uml:Package";
            case "Profile" -> "uml:Profile";
            case "Stereotype" -> "uml:Stereotype";
            case "ValueType" -> "uml:DataType";
            case "PartProperty" -> "uml:Property";
            case "Port" -> "uml:Port";
            case "Action" -> "uml:ActivityNode";
            case "State" -> "uml:State";
            case "Lifeline" -> "uml:Lifeline";
            default -> "uml:Class";
        };
    }

    /* ---------------- 导入 ---------------- */

    @Override
    public ModelSnapshot importModel(ExchangeBundle bundle) {
        if (bundle == null || bundle.semantic() == null || bundle.semantic().isBlank()) {
            throw new ExchangeException("缺少 XMI 语义内容");
        }
        Document document = parse(bundle.semantic());

        List<ModelElement> elements = new ArrayList<>();
        List<Relationship> relationships = new ArrayList<>();

        Element model = firstElement(document, NS_UML, "Model");
        Element container = model == null ? document.getDocumentElement() : model;

        // 元素树：uml:Model 自身就是根元素，不在它的子节点里，必须单独收。
        if (model != null) {
            addElement(model, "", elements);
            collectElements(model, attribute(model, NS_XMI, "id"), elements, relationships);
        } else {
            collectElements(document.getDocumentElement(), null, elements, relationships);
        }

        // 关系：Association 节点。
        for (Element association : elementsOf(document, NS_UML, "Association")) {
            String type = attribute(association, NS_SCOFEN, "relationType");
            if (type == null || type.isBlank()) {
                type = association.getAttribute("name");
            }
            String sourceId = attribute(association, NS_SCOFEN, "sourceId");
            String targetId = attribute(association, NS_SCOFEN, "targetId");
            if (sourceId == null || targetId == null) {
                // 没有扩展属性时按两个 ownedEnd 的顺序推断端点。
                List<Element> ends = elementsOf(association, NS_UML, "Property");
                if (ends.size() < 2) {
                    continue;
                }
                sourceId = attribute(ends.get(0), NS_SCOFEN, "ref");
                targetId = attribute(ends.get(1), NS_SCOFEN, "ref");
                if (sourceId == null) {
                    sourceId = ends.get(0).getAttribute("name");
                }
                if (targetId == null) {
                    targetId = ends.get(1).getAttribute("name");
                }
            }
            if (sourceId == null || targetId == null) {
                continue;
            }
            relationships.add(new Relationship(
                    attributeOr(association, NS_XMI, "id", "rel-" + relationships.size()),
                    type == null || type.isBlank() ? "dependency" : type,
                    sourceId, targetId,
                    association.hasAttribute("name") ? association.getAttribute("name") : "",
                    attributeOr(association, NS_SCOFEN, "documentation", ""),
                    readStringList(association, "stereotypes"),
                    attribute(association, NS_SCOFEN, "ownerId"),
                    readStringMap(association, "taggedValues"),
                    readValueMap(association, "properties")));
        }

        // 侧车：图与记号。
        List<Diagram> diagrams = new ArrayList<>();
        List<Notation> notations = new ArrayList<>();
        if (bundle.notationSidecar() != null && !bundle.notationSidecar().isBlank()) {
            SidecarReader reader = SidecarReader.parse(bundle.notationSidecar());
            diagrams.addAll(reader.diagrams());
            notations.addAll(reader.notations());
        }

        return new ModelSnapshot(0L, elements, relationships, diagrams, notations);
    }

    private void collectElements(Element parent, String ownerId, List<ModelElement> elements,
                                 List<Relationship> relationships) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (!(node instanceof Element child)) {
                continue;
            }
            String namespace = child.getNamespaceURI();
            String local = child.getLocalName();
            if (NS_UML.equals(namespace) && "Association".equals(local)) {
                continue;
            }
            if (NS_SCOFEN.equals(namespace)) {
                continue;
            }
            if (attribute(child, NS_XMI, "id") == null) {
                continue;
            }
            addElement(child, ownerId, elements);
            collectElements(child, attribute(child, NS_XMI, "id"), elements, relationships);
        }
    }

    /** 把一个 XML 元素读成 Scofen 元素；ownerId 优先取扩展属性，缺失时用父级兜底。 */
    private void addElement(Element child, String fallbackOwnerId, List<ModelElement> elements) {
        String id = attribute(child, NS_XMI, "id");
        if (id == null || id.isBlank()) {
            return;
        }
        String type = attribute(child, NS_SCOFEN, "type");
        if (type == null || type.isBlank()) {
            type = scofenTypeFromUml(child.getLocalName());
        }
        String name = child.hasAttribute("name") ? child.getAttribute("name") : "";
        String ownerId = attribute(child, NS_SCOFEN, "ownerId");
        if (ownerId == null || ownerId.isBlank()) {
            ownerId = fallbackOwnerId == null ? "" : fallbackOwnerId;
        }
        elements.add(new ModelElement(id, type, name,
                readStringList(child, "stereotypes"), ownerId,
                attributeOr(child, NS_SCOFEN, "documentation", ""),
                readStringMap(child, "taggedValues"),
                attribute(child, NS_SCOFEN, "xmiId"),
                readValueMap(child, "properties")));
    }

    /** 标准 UML 元素名 → Scofen 类型（没有 scofen:type 扩展时的兜底）。 */
    static String scofenTypeFromUml(String umlLocalName) {
        if (umlLocalName == null) {
            return "Block";
        }
        return switch (umlLocalName) {
            case "Model" -> "Model";
            case "Package" -> "Package";
            case "Profile" -> "Profile";
            case "Stereotype" -> "Stereotype";
            case "DataType" -> "ValueType";
            case "Property" -> "PartProperty";
            case "Port" -> "Port";
            case "ActivityNode" -> "Action";
            case "State" -> "State";
            case "Lifeline" -> "Lifeline";
            default -> "Block";
        };
    }

    private List<String> readStringList(Element parent, String localName) {
        Element holder = firstElement(parent, NS_SCOFEN, localName);
        if (holder == null) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (Element item : elementsOf(holder, NS_SCOFEN, "value")) {
            values.add(item.getTextContent());
        }
        return List.copyOf(values);
    }

    private Map<String, String> readStringMap(Element parent, String localName) {
        Element holder = firstElement(parent, NS_SCOFEN, localName);
        if (holder == null) {
            return Map.of();
        }
        Map<String, String> values = new LinkedHashMap<>();
        for (Element item : elementsOf(holder, NS_SCOFEN, "entry")) {
            values.put(item.getAttribute("key"), item.getAttribute("value"));
        }
        return Map.copyOf(values);
    }

    private Map<String, Object> readValueMap(Element parent, String localName) {
        Element holder = firstElement(parent, NS_SCOFEN, localName);
        if (holder == null) {
            return Map.of();
        }
        Map<String, Object> values = new LinkedHashMap<>();
        for (Element item : elementsOf(holder, NS_SCOFEN, "property")) {
            String key = item.getAttribute("key");
            List<Element> items = elementsOf(item, NS_SCOFEN, "value");
            if (!items.isEmpty()) {
                List<String> values2 = new ArrayList<>();
                for (Element element : items) {
                    values2.add(element.getTextContent());
                }
                values.put(key, List.copyOf(values2));
            } else if (item.hasAttribute("value")) {
                values.put(key, item.getAttribute("value"));
            }
        }
        return Map.copyOf(values);
    }

    private static String attribute(Element node, String namespace, String localName) {
        String value = node.getAttributeNS(namespace, localName);
        if (value == null || value.isBlank()) {
            // 有些生产者不带命名空间，退回无前缀属性。
            value = node.getAttribute(localName);
        }
        return value == null || value.isBlank() ? null : value;
    }

    private static String attributeOr(Element node, String namespace, String localName, String fallback) {
        String value = attribute(node, namespace, localName);
        return value == null ? fallback : value;
    }

    /**
     * 只在<b>直接子元素</b>里找。
     *
     * <p>不能用 {@code getElementsByTagNameNS}：它是递归查找，会跨到兄弟子树里去，
     * 于是 A 元素的标记值可能被读成 B 元素的——这类串数据很难在界面上看出来。</p>
     */
    private static Element firstElement(Element parent, String namespace, String localName) {
        NodeList nodes = parent.getChildNodes();
        for (int i = 0; i < nodes.getLength(); i++) {
            Node node = nodes.item(i);
            if (node instanceof Element element
                    && namespace.equals(element.getNamespaceURI())
                    && localName.equals(element.getLocalName())) {
                return element;
            }
        }
        return null;
    }

    private static List<Element> elementsOf(Element parent, String namespace, String localName) {
        List<Element> result = new ArrayList<>();
        NodeList nodes = parent.getElementsByTagNameNS(namespace, localName);
        for (int i = 0; i < nodes.getLength(); i++) {
            result.add((Element) nodes.item(i));
        }
        return result;
    }

    private static Element firstElement(Document document, String namespace, String localName) {
        NodeList nodes = document.getElementsByTagNameNS(namespace, localName);
        return nodes.getLength() == 0 ? null : (Element) nodes.item(0);
    }

    private static List<Element> elementsOf(Document document, String namespace, String localName) {
        List<Element> result = new ArrayList<>();
        NodeList nodes = document.getElementsByTagNameNS(namespace, localName);
        for (int i = 0; i < nodes.getLength(); i++) {
            result.add((Element) nodes.item(i));
        }
        return result;
    }

    /* ---------------- XML 基础设施 ---------------- */

    private Document parse(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            // 关闭外部实体，防止 XXE。
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.parse(new InputSource(new StringReader(xml)));
        } catch (Exception ex) {
            throw new ExchangeException("解析 XMI 失败", ex);
        }
    }

    private String serialize(Document document) {
        try {
            TransformerFactory factory = TransformerFactory.newInstance();
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
            Transformer transformer = factory.newTransformer();
            transformer.setOutputProperty(OutputKeys.INDENT, "yes");
            transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
            transformer.setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "2");
            StringWriter writer = new StringWriter();
            transformer.transform(new DOMSource(document), new StreamResult(writer));
            return writer.toString();
        } catch (TransformerException ex) {
            throw new ExchangeException("序列化 XMI 失败", ex);
        }
    }

    private String sidecarJson(NotationSidecar.Sidecar sidecar) {
        return SidecarWriter.toJson(NotationSidecar.toMap(sidecar));
    }

    /** 侧车 JSON 的读写独立成类，避免把 Jackson 细节散在适配器里。 */
    static final class SidecarWriter {
        private SidecarWriter() {
        }

        static String toJson(Map<String, Object> map) {
            return com.scofen.model.core.SnapshotCodec.toJsonObject(map);
        }
    }

    /** 侧车解析：图与记号。 */
    static final class SidecarReader {
        private final List<Diagram> diagrams;
        private final List<Notation> notations;

        private SidecarReader(List<Diagram> diagrams, List<Notation> notations) {
            this.diagrams = diagrams;
            this.notations = notations;
        }

        List<Diagram> diagrams() {
            return diagrams;
        }

        List<Notation> notations() {
            return notations;
        }

        static SidecarReader parse(String json) {
            Map<String, Object> map = com.scofen.model.core.SnapshotCodec.fromMap(json);
            List<Diagram> diagrams = new ArrayList<>();
            List<Notation> notations = new ArrayList<>();
            for (Object item : listOf(map.get("diagrams"))) {
                Map<String, Object> row = asMap(item);
                String kind = String.valueOf(row.getOrDefault("kind", "pkg"));
                DiagramKind diagramKind;
                try {
                    diagramKind = DiagramKind.fromCode(kind);
                } catch (RuntimeException ex) {
                    diagramKind = DiagramKind.PKG;
                }
                diagrams.add(new Diagram(String.valueOf(row.get("id")), diagramKind,
                        String.valueOf(row.getOrDefault("name", "")), asString(row.get("ownerId")),
                        listOf(row.get("elementIds")).stream().map(String::valueOf).toList(),
                        listOf(row.get("relationshipIds")).stream().map(String::valueOf).toList()));
            }
            for (Object item : listOf(map.get("notations"))) {
                Map<String, Object> row = asMap(item);
                notations.add(new Notation(String.valueOf(row.get("id")),
                        String.valueOf(row.get("diagramId")), String.valueOf(row.get("elementId")),
                        asDouble(row.get("x")), asDouble(row.get("y")),
                        asDouble(row.get("width")), asDouble(row.get("height")),
                        stringMap(row.get("style"))));
            }
            return new SidecarReader(List.copyOf(diagrams), List.copyOf(notations));
        }

        private static List<?> listOf(Object value) {
            return value instanceof List<?> list ? list : List.of();
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> asMap(Object value) {
            return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        }

        private static String asString(Object value) {
            return value == null ? null : String.valueOf(value);
        }

        private static double asDouble(Object value) {
            if (value instanceof Number number) {
                return number.doubleValue();
            }
            try {
                return value == null ? 0d : Double.parseDouble(String.valueOf(value));
            } catch (NumberFormatException ex) {
                return 0d;
            }
        }

        @SuppressWarnings("unchecked")
        private static Map<String, String> stringMap(Object value) {
            if (!(value instanceof Map<?, ?> map)) {
                return Map.of();
            }
            Map<String, String> result = new LinkedHashMap<>();
            map.forEach((key, item) -> result.put(String.valueOf(key), String.valueOf(item)));
            return Map.copyOf(result);
        }
    }
}
