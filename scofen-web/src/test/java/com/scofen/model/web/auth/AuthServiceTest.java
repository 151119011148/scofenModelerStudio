package com.scofen.model.web.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 超管口令校验与 JWT 登录态。 */
class AuthServiceTest {

    private AuthService service() {
        return new AuthService("scofen", "", AuthService.DEFAULT_PASSWORD_HASH, "unit-test-secret", 3600);
    }

    @Test
    void superAdminCanLoginWithConfiguredPassword() {
        AuthService.Session session = service().login("scofen", "Gf651125");
        assertThat(session.user().username()).isEqualTo("scofen");
        assertThat(session.user().admin()).isTrue();
        assertThat(session.token()).isNotBlank();
        assertThat(service().validToken(session.token())).isTrue();
    }

    @Test
    void wrongCredentialsAreRejected() {
        assertThatThrownBy(() -> service().login("scofen", "wrong"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service().login("someone", "Gf651125"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void tamperedOrForeignTokenIsRejected() {
        AuthService auth = service();
        String token = auth.login("scofen", "Gf651125").token();
        assertThat(auth.validToken(token + "x")).isFalse();
        assertThat(auth.validToken(null)).isFalse();
        AuthService otherKey = new AuthService("scofen", "", AuthService.DEFAULT_PASSWORD_HASH,
                "another-secret", 3600);
        assertThat(auth.validToken(otherKey.login("scofen", "Gf651125").token())).isFalse();
    }

    @Test
    void plainPasswordEnvironmentOverrideIsHashedAndAccepted() {
        AuthService overridden = new AuthService("scofen", "runtime-secret", "", "unit-test-secret", 3600);
        assertThat(overridden.login("scofen", "runtime-secret").token()).isNotBlank();
        assertThatThrownBy(() -> overridden.login("scofen", "Gf651125"))
                .isInstanceOf(SecurityException.class);
    }
}
