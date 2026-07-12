import type { ReactNode } from 'react';
export type ChipProps = {
    label: string;
    selected?: boolean;
    onSelect?: () => void;
    /** 전달하면 우측에 × 제거 버튼이 생긴다 */
    onRemove?: () => void;
    disabled?: boolean;
    size?: 'sm' | 'md';
    leading?: ReactNode;
};
export declare function Chip({ label, selected, onSelect, onRemove, disabled, size, leading, }: ChipProps): import("react").JSX.Element;
