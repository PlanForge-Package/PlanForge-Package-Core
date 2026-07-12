export type TextareaProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    rows?: number;
    maxLength?: number;
    showCounter?: boolean;
    /** 내용에 맞춰 높이 자동 조절 (기본 켜짐) */
    autoResize?: boolean;
    error?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    helperText?: string;
};
export declare function Textarea({ label, value, onChange, placeholder, rows, maxLength, showCounter, autoResize, error, disabled, readOnly, required, helperText, }: TextareaProps): import("react").JSX.Element;
