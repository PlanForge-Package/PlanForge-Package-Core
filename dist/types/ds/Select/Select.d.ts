export type SelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};
export type SelectProps = {
    label?: string;
    value: string | null;
    onChange?: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
};
export declare function Chevron(): import("react").JSX.Element;
export declare function CheckIcon(): import("react").JSX.Element;
/** 드롭다운 외부 클릭/Escape 닫기 공용 훅 — Select/MultiSelect/Autocomplete에서 재사용 */
export declare function useDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void): void;
export declare function Select({ label, value, onChange, options, placeholder, disabled, error, helperText, }: SelectProps): import("react").JSX.Element;
