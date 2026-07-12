import type { ReactNode } from 'react';
export type HeaderProps = {
    title: string;
    description?: string;
    breadcrumb?: ReactNode;
    actions?: ReactNode;
    /** 하단 보더 표시 (기본 true) */
    divider?: boolean;
};
export declare function Header({ title, description, breadcrumb, actions, divider }: HeaderProps): import("react").JSX.Element;
