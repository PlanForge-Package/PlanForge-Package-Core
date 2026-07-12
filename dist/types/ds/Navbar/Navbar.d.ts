import type { ReactNode } from 'react';
export type NavbarItem = {
    label: string;
    value: string;
};
export type NavbarProps = {
    brand: string;
    items: NavbarItem[];
    value: string;
    onChange?: (value: string) => void;
    actions?: ReactNode;
    sticky?: boolean;
};
export declare function Navbar({ brand, items, value, onChange, actions, sticky }: NavbarProps): import("react").JSX.Element;
