package com.scofen.model.xmi;

/** 交换层的失败：格式不支持、载荷缺失、内容不合法等。 */
public class ExchangeException extends RuntimeException {

    public ExchangeException(String message) {
        super(message);
    }

    public ExchangeException(String message, Throwable cause) {
        super(message, cause);
    }
}
