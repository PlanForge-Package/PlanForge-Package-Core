import { type SelectOption } from '../Select/Select';
export type FilterBarFilter = {
    key: string;
    label: string;
    options: SelectOption[];
};
export type FilterBarChip = {
    key: string;
    label: string;
};
export type FilterBarProps = {
    searchValue: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
    filters?: FilterBarFilter[];
    filterValues?: Record<string, string | null>;
    onFilterChange?: (key: string, value: string | null) => void;
    /** 적용된 필터 칩 — onRemoveChip으로 제거 */
    activeChips?: FilterBarChip[];
    onRemoveChip?: (key: string) => void;
    /** 있으면 우측에 '초기화' 버튼 표시 */
    onReset?: () => void;
};
export declare function FilterBar({ searchValue, onSearchChange, searchPlaceholder, filters, filterValues, onFilterChange, activeChips, onRemoveChip, onReset, }: FilterBarProps): import("react").JSX.Element;
