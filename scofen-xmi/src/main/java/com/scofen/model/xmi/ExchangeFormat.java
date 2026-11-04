package com.scofen.model.xmi;

/** 交换格式矩阵。标准 XMI 只承载语义，图层必须走侧车或自有格式。 */
public enum ExchangeFormat {
    XMI_251("xmi", "OMG XMI 2.5.1", false),
    CAMEO_MDXML("mdxml", "Cameo .mdxml", false),
    CAMEO_MDZIP("mdzip", "Cameo .mdzip", false),
    DI_SIDECAR("di.json", "布局侧车 .di.json", true),
    SCOFEN_JSON("scofen.json", "自有无损格式 .scofen.json", true);

    private final String code;
    private final String label;
    private final boolean carriesNotation;

    ExchangeFormat(String code, String label, boolean carriesNotation) {
        this.code = code;
        this.label = label;
        this.carriesNotation = carriesNotation;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    public boolean carriesNotation() {
        return carriesNotation;
    }
}
