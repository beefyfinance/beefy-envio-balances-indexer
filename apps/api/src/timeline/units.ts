/** `1500000000000000000n` with 18 decimals is `"1.5"`. Exact: no float on the way. */
export const formatUnits = (value: bigint, decimals: number): string => {
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
    const whole = digits.slice(0, digits.length - decimals);
    const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
};
