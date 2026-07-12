import type { ReactNode } from 'react';
export type CalloutTone = 'info' | 'success' | 'warning' | 'error';
export type CalloutProps = {
    tone?: CalloutTone;
    title?: string;
    children: ReactNode;
};
export declare function Callout({ tone, title, children }: CalloutProps): import("react").JSX.Element;
