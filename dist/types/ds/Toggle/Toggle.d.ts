export type ToggleProps = {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    size?: 'sm' | 'md';
    disabled?: boolean;
    label?: string;
};
export declare function Toggle({ checked, onChange, size, disabled, label }: ToggleProps): import("react").JSX.Element;
