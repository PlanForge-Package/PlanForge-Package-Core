export type KrBizNoFieldProps = {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    helperText?: string;
};
export declare function KrBizNoField({ label, value, onChange, disabled, helperText, }: KrBizNoFieldProps): import("react").JSX.Element;
