export type SearchFieldProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Enter 입력 시 호출 */
    onSearch?: (value: string) => void;
    /** 값이 있을 때 지우기(×) 버튼 표시 (기본 표시) */
    showClear?: boolean;
};
export declare function SearchField({ label, value, onChange, placeholder, disabled, onSearch, showClear, }: SearchFieldProps): import("react").JSX.Element;
