import type { ReactNode } from 'react';
export type ModalProps = {
    open: boolean;
    onClose?: () => void;
    title?: string;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    showClose?: boolean;
    /** 문서/데모용 인라인 렌더 — fixed 오버레이 없이 정적 배치 */
    inline?: boolean;
};
export declare function Modal({ open, onClose, title, children, footer, size, showClose, inline, }: ModalProps): import("react").JSX.Element;
