import type { ReactNode } from 'react';
import { type NavbarItem } from '../Navbar/Navbar';
import { type SidebarSection } from '../Sidebar/Sidebar';
export type AdminShellProps = {
    brand: string;
    navItems: NavbarItem[];
    navValue: string;
    onNavChange?: (value: string) => void;
    sidebarSections: SidebarSection[];
    sidebarValue: string;
    onSidebarChange?: (value: string) => void;
    actions?: ReactNode;
    children: ReactNode;
    /** 본문 영역 패딩 적용 여부 (기본 true) */
    contentPadding?: boolean;
};
export declare function AdminShell({ brand, navItems, navValue, onNavChange, sidebarSections, sidebarValue, onSidebarChange, actions, children, contentPadding, }: AdminShellProps): import("react").JSX.Element;
