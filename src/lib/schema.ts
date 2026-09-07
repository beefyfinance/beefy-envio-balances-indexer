import { S } from 'envio';
import type { BigDecimal } from './decimal';
import { hexSchema } from './hex';
export type ToBigDecimal<T> = {
    [K in keyof T]: T[K] extends bigint
        ? BigDecimal
        : T[K] extends bigint[]
          ? BigDecimal[]
          : T[K] extends readonly bigint[]
            ? BigDecimal[]
            : T[K];
};

export const fetchTokenSchema = S.schema({
    address: hexSchema,
    decimals: S.number,
});

export type FetchToken = S.Infer<typeof fetchTokenSchema>;
