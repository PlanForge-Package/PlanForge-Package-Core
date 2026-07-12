export type CheckboxProps = {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    indeterminate?: boolean;
};
export declare function Checkbox({ checked, onChange, label, disabled, indeterminate, }: CheckboxProps): import("react").JSX.Element;
