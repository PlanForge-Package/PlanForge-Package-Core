export type CurrencyFieldProps = {
    label?: string;
    /** 숫자만 담긴 문자열 (예: "1500000") — 표시할 때 천단위 콤마 포맷 */
    value: string;
    onChange?: (digits: string) => void;
    /** 우측 통화 단위 표기 */
    currency?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    error?: boolean;
    helperText?: string;
    /** 최대 금액 — 초과 입력 차단 */
    max?: number;
};
export declare function CurrencyField({ label, value, onChange, currency, placeholder, disabled, readOnly, error, helperText, max, }: CurrencyFieldProps): import("react").JSX.Element;
