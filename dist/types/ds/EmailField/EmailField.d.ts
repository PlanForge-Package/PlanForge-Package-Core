export type EmailFieldProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    /** 블러 시 형식 검증 → 정상·에러 상태 자동 표시 (기본 켜짐) */
    validate?: boolean;
    onValidChange?: (valid: boolean) => void;
    disabled?: boolean;
    required?: boolean;
    helperText?: string;
};
export declare function EmailField({ label, value, onChange, placeholder, validate, onValidChange, disabled, required, helperText, }: EmailFieldProps): import("react").JSX.Element;
