import type { ReactNode } from 'react';
export type BottomSheetProps = {
    open: boolean;
    onClose?: () => void;
    title?: string;
    children: ReactNode;
    /** true면 상단 그립바 표시 */
    showHandle?: boolean;
    /** 문서/데모용 인라인 렌더 — fixed 오버레이 없이 정적 배치 */
    inline?: boolean;
};
export declare function BottomSheet({ open, onClose, title, children, showHandle, inline, }: BottomSheetProps): import("react").JSX.Element;
