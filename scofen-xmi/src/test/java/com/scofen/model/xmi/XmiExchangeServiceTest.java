package com.scofen.model.xmi;

import com.scofen.model.metamodel.DiagramKind;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class XmiExchangeServiceTest {

    private final XmiExchangeService service = new XmiExchangeService();

    @Test
    void formatMatrixSeparatesSemanticsFromNotation() {
        assertThat(ExchangeFormat.XMI_251.carriesNotation()).isFalse();
        assertThat(ExchangeFormat.CAMEO_MDXML.carriesNotation()).isFalse();
        assertThat(ExchangeFormat.CAMEO_MDZIP.carriesNotation()).isFalse();
        assertThat(ExchangeFormat.DI_SIDECAR.carriesNotation()).isTrue();
        assertThat(ExchangeFormat.SCOFEN_JSON.carriesNotation()).isTrue();
    }

    @Test
    void standardXmiWithoutSidecarIsRejected() {
        ExchangeBundle bare = new ExchangeBundle(ExchangeFormat.XMI_251, "<xmi/>", null, List.of());
        assertThatThrownBy(() -> service.validateImport(bare))
                .isInstanceOf(ExchangeException.class)
                .hasMessageContaining("sidecar");

        ExchangeBundle withSidecar = new ExchangeBundle(ExchangeFormat.XMI_251, "<xmi/>",
                "{\"diagrams\":[]}", List.of());
        assertThatCode(() -> service.validateImport(withSidecar)).doesNotThrowAnyException();
    }

    @Test
    void scofenJsonIsLosslessWithoutSidecar() {
        ExchangeBundle bundle = new ExchangeBundle(ExchangeFormat.SCOFEN_JSON,
                "{\"elements\":[],\"notations\":[]}", null, List.of());
        assertThatCode(() -> service.validateImport(bundle)).doesNotThrowAnyException();
    }

    @Test
    void nineDiagramLayoutMustBeComplete() {
        ExchangeBundle full = new ExchangeBundle(ExchangeFormat.SCOFEN_JSON, "{}", null,
                Arrays.asList(DiagramKind.values()));
        assertThatCode(() -> service.assertNineDiagramLayout(full)).doesNotThrowAnyException();

        List<DiagramKind> eight = Arrays.stream(DiagramKind.values())
                .filter(k -> k != DiagramKind.PAR).toList();
        ExchangeBundle incomplete = new ExchangeBundle(ExchangeFormat.XMI_251, "<xmi/>", "{}", eight);
        assertThatThrownBy(() -> service.assertNineDiagramLayout(incomplete))
                .isInstanceOf(ExchangeException.class)
                .hasMessageContaining("Expected 9");
    }

    @Test
    void missingAdapterIsReportedExplicitly() {
        assertThat(service.supportedFormats()).isEmpty();
        assertThat(service.hasAdapter(ExchangeFormat.CAMEO_MDXML)).isFalse();
        assertThatThrownBy(() -> service.requireAdapter(ExchangeFormat.CAMEO_MDXML))
                .isInstanceOf(ExchangeException.class)
                .hasMessageContaining("No adapter");
    }
}
