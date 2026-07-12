import type { ReactNode } from 'react';
export type PopoverProps = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger: ReactNode;
    title?: string;
    children: ReactNode;
    placement?: 'bottom-start' | 'bottom-end';
    showArrow?: boolean;
};
export declare function Popover({ open, onOpenChange, trigger, title, children, placement, showArrow, }: PopoverProps): import("react").JSX.Element;
