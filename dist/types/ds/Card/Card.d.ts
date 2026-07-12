import type { ReactNode } from 'react';
export type CardProps = {
    title: string;
    showFooter?: boolean;
    children: ReactNode;
};
export declare function Card({ title, showFooter, children }: CardProps): import("react").JSX.Element;
