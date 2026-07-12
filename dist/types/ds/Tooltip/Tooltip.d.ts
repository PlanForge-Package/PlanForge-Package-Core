import type { ReactNode } from 'react';
export type TooltipProps = {
    content: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    /** 트리거 — 키보드 접근을 위해 포커스 가능한 요소(버튼 등)를 권장 */
    children: ReactNode;
    /** 마우스 진입 후 표시까지의 지연(ms) */
    delay?: number;
    /** 문서용: 호버 없이 항상 표시 */
    alwaysVisible?: boolean;
};
export declare function Tooltip({ content, placement, children, delay, alwaysVisible, }: TooltipProps): import("react").JSX.Element;
