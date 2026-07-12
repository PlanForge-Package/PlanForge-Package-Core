export type TextFieldProps = {
    label: string;
    placeholder?: string;
    error?: boolean;
    success?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    size?: 'sm' | 'md' | 'lg';
    description?: string;
    showDescription?: boolean;
    helperText?: string;
    maxLength?: number;
    showCounter?: boolean;
};
export declare function TextField({ label, placeholder, error, success, disabled, readOnly, size, description, showDescription, helperText, maxLength, showCounter, }: TextFieldProps): import("react").JSX.Element;
