export type KrAccountFieldProps = {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    disabled?: boolean;
    error?: boolean;
    success?: boolean;
    helperText?: string;
};
export declare function KrAccountField({ value, onChange, label, disabled, error, success, helperText, }: KrAccountFieldProps): import("react").JSX.Element;
