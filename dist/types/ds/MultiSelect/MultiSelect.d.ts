import { type SelectOption } from '../Select/Select';
export type MultiSelectProps = {
    label?: string;
    values: string[];
    onChange?: (values: string[]) => void;
    options: SelectOption[];
    placeholder?: string;
    /** 최대 선택 개수 — 도달 시 미선택 옵션 클릭 무시 */
    maxSelected?: number;
    disabled?: boolean;
    helperText?: string;
};
export declare function MultiSelect({ label, values, onChange, options, placeholder, maxSelected, disabled, helperText, }: MultiSelectProps): import("react").JSX.Element;
