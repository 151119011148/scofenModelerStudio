package com.scofen.model.web.auth;

import com.scofen.model.web.rbac.NoopUserDirectory;
import com.scofen.model.web.rbac.Permission;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 超管账号清单、口令校验与 JWT 登录态。 */
class AuthServiceTest {

    /** 初始默认口令，编码存放以免明文进入 Git 历史；部署时应通过环境变量替换。 */
    private static final String DEFAULT_PASSWORD = new String(
            Base64.getDecoder().decode("R2Y2NTExMjU="), StandardCharsets.UTF_8);

    private AuthService service() {
        return new AuthService("scofen,gaofeng", "", AuthService.DEFAULT_PASSWORD_HASH,
                "unit-test-secret", 3600, new NoopUserDirectory());
    }

    @Test
    void bothSuperAdminsCanLoginAndKeepOwnIdentity() {
        AuthService auth = service();
        for (String account : new String[]{"scofen", "gaofeng"}) {
            AuthService.Session session = auth.login(account, DEFAULT_PASSWORD);
            assertThat(session.user().username()).isEqualTo(account);
            assertThat(session.user().admin()).isTrue();
            assertThat(session.token()).isNotBlank();
            assertThat(auth.validToken(session.token())).isTrue();
            assertThat(auth.parseOrNull(session.token()).username()).isEqualTo(account);
        }
    }

    @Test
    void wrongCredentialsAreRejected() {
        AuthService auth = service();
        assertThatThrownBy(() -> auth.login("scofen", "wrong"))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> auth.login("someone", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
        // 账号大小写敏感，不做大小写归一化。
        assertThatThrownBy(() -> auth.login("Scofen", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> auth.login("GAOFENG", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void tamperedOrForeignTokenIsRejected() {
        AuthService auth = service();
        String token = auth.login("gaofeng", DEFAULT_PASSWORD).token();
        assertThat(auth.validToken(token + "x")).isFalse();
        assertThat(auth.validToken(null)).isFalse();
        AuthService otherKey = new AuthService("scofen,gaofeng", "", AuthService.DEFAULT_PASSWORD_HASH,
                "another-secret", 3600, new NoopUserDirectory());
        assertThat(auth.validToken(otherKey.login("scofen", DEFAULT_PASSWORD).token())).isFalse();
    }

    @Test
    void plainPasswordEnvironmentOverrideIsHashedAndAccepted() {
        AuthService overridden = new AuthService("scofen,gaofeng", "runtime-secret", "",
                "unit-test-secret", 3600, new NoopUserDirectory());
        assertThat(overridden.login("scofen", "runtime-secret").token()).isNotBlank();
        assertThat(overridden.login("gaofeng", "runtime-secret").token()).isNotBlank();
        assertThatThrownBy(() -> overridden.login("scofen", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void customUsernamesOverrideDefaults() {
        AuthService custom = new AuthService("only-one", "", AuthService.DEFAULT_PASSWORD_HASH,
                "unit-test-secret", 3600, new NoopUserDirectory());
        assertThat(custom.login("only-one", DEFAULT_PASSWORD).user().username()).isEqualTo("only-one");
        assertThatThrownBy(() -> custom.login("scofen", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> custom.login("gaofeng", DEFAULT_PASSWORD))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void blankUsernamesFallsBackToScofen() {
        AuthService fallback = new AuthService(" , ", "", AuthService.DEFAULT_PASSWORD_HASH,
                "unit-test-secret", 3600, new NoopUserDirectory());
        assertThat(fallback.login("scofen", DEFAULT_PASSWORD).token()).isNotBlank();
    }
}
