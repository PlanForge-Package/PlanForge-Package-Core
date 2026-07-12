import type { ReactNode } from 'react';
export type EmptyStateProps = {
    title: string;
    description?: string;
    /** 기본: 인라인 inbox 아이콘 */
    icon?: ReactNode;
    actionLabel?: string;
    onAction?: () => void;
    /** 패딩/아이콘 축소 */
    compact?: boolean;
};
export declare function EmptyState({ title, description, icon, actionLabel, onAction, compact, }: EmptyStateProps): import("react").JSX.Element;
