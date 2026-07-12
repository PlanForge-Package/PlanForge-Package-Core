export type KrCvcFieldProps = {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
};
export declare function KrCvcField({ value, onChange, label, disabled, error, helperText, }: KrCvcFieldProps): import("react").JSX.Element;
