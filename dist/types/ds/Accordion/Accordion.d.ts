import type { ReactNode } from 'react';
export type AccordionItem = {
    id: string;
    title: string;
    content: ReactNode;
    disabled?: boolean;
};
export type AccordionProps = {
    items: AccordionItem[];
    multiple?: boolean;
    defaultOpenIds?: string[];
};
export declare function Accordion({ items, multiple, defaultOpenIds }: AccordionProps): import("react").JSX.Element;
