import type { ReactNode } from 'react';
export type ButtonProps = {
    variant: 'primary' | 'secondary' | 'error' | 'success' | 'warning';
    appearance?: 'solid' | 'outline' | 'ghost';
    size: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    label: string;
    showIcon?: boolean;
    icon?: ReactNode;
    onClick?: () => void;
};
export declare function Button({ variant, appearance, size, disabled, label, showIcon, icon, onClick, }: ButtonProps): import("react").JSX.Element;
