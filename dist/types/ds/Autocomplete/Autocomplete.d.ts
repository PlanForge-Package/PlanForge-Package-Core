export type AutocompleteProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    /** 자동완성 후보 목록 */
    options: string[];
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
    /** 검색 결과 없음 문구 */
    emptyText?: string;
    /** 표시할 최대 후보 수 */
    maxSuggestions?: number;
    /** 후보 선택 시 호출 */
    onSelect?: (value: string) => void;
};
export declare function Autocomplete({ label, value, onChange, options, placeholder, disabled, error, helperText, emptyText, maxSuggestions, onSelect, }: AutocompleteProps): import("react").JSX.Element;
