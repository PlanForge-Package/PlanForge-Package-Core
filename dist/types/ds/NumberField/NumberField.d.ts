export type NumberFieldProps = {
    label?: string;
    value: number;
    onChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    /** 값 우측에 표시할 단위 (예: 개, %) */
    unit?: string;
    disabled?: boolean;
    readOnly?: boolean;
    helperText?: string;
};
export declare function NumberField({ label, value, onChange, min, max, step, unit, disabled, readOnly, helperText, }: NumberFieldProps): import("react").JSX.Element;
