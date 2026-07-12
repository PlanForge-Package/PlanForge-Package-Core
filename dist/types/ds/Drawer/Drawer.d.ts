import type { ReactNode } from 'react';
export type DrawerProps = {
    open: boolean;
    onClose?: () => void;
    title?: string;
    children: ReactNode;
    side?: 'left' | 'right';
    width?: number;
    /** 문서/데모용 정적 렌더 — 백드롭·고정 위치 없이 흐름 안에 렌더 */
    inline?: boolean;
};
export declare function Drawer({ open, onClose, title, children, side, width, inline, }: DrawerProps): import("react").JSX.Element;
