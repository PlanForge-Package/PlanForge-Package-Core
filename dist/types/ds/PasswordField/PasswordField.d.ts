export type PasswordFieldProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    error?: boolean;
    success?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    helperText?: string;
    maxLength?: number;
    /** 표시/숨김 토글 버튼 (기본 표시) */
    showToggle?: boolean;
};
export declare function PasswordField({ label, value, onChange, placeholder, error, success, disabled, readOnly, required, helperText, maxLength, showToggle, }: PasswordFieldProps): import("react").JSX.Element;
