export type DropdownItem = {
    label: string;
    onSelect?: () => void;
    danger?: boolean;
    disabled?: boolean;
    /** 해당 항목 위 구분선 */
    divider?: boolean;
};
export type DropdownProps = {
    /** 트리거 버튼 텍스트 */
    label: string;
    items: DropdownItem[];
    disabled?: boolean;
    align?: 'start' | 'end';
};
export declare function Dropdown({ label, items, disabled, align }: DropdownProps): import("react").JSX.Element;
