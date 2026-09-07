import { BigDecimal } from 'envio';

export { BigDecimal };
export const DEFAULT_DECIMAL_PLACES = 50;

BigDecimal.set({
    // make sure we have enough precision
    DECIMAL_PLACES: DEFAULT_DECIMAL_PLACES,
    // configure the Decimals lib to format without exponents
    EXPONENTIAL_AT: [-250, 250],
});

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000' as const;
export const BIG_ZERO = new BigDecimal(0);
export const BIG_ONE = new BigDecimal(1);
export const BIG_TEN = new BigDecimal(10);
export const MAX_UINT256 = BigInt(
    // 0xffffffffffffffffffffffffffffffffffffffff
    '115792089237316195423570985008687907853269984665640564039457584007913129639935'
);

export const interpretAsDecimal = (
    rawValue: string | bigint | BigDecimal | number,
    decimals: string | number
): BigDecimal => {
    const stringValue = rawValue.toString();
    return new BigDecimal(stringValue).dividedBy(BIG_TEN.pow(decimals));
};

export const interpretAllAsDecimal = (
    rawValues: (string | bigint | BigDecimal | number)[],
    decimals: string | number
): BigDecimal[] => {
    return rawValues.map((rawValue) => interpretAsDecimal(rawValue, decimals));
};

export const changeValueEncoding = (value: bigint, currentDecimals: number, requestedDecimals: number): bigint => {
    if (currentDecimals === requestedDecimals) {
        return value;
    }
    if (currentDecimals > requestedDecimals) {
        return value / 10n ** BigInt(currentDecimals - requestedDecimals);
    }
    return value * 10n ** BigInt(requestedDecimals - currentDecimals);
};

export const PRICE_STORE_DECIMALS_USD = 18;
export const PRICE_STORE_DECIMALS_TOKEN_TO_NATIVE = 18;
export const BEEFY_SWAPPER_VALUE_SCALER = 1000n;
