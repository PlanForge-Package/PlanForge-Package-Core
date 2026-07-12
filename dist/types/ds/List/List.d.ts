import type { ReactNode } from 'react';
export type ListItem = {
    id: string;
    title: string;
    description?: string;
    leading?: ReactNode;
    trailing?: ReactNode;
    disabled?: boolean;
};
export type ListProps = {
    items: ListItem[];
    onItemClick?: (item: ListItem) => void;
    divider?: boolean;
    selectable?: boolean;
    selectedId?: string | null;
    onSelect?: (id: string) => void;
};
export declare function List({ items, onItemClick, divider, selectable, selectedId, onSelect, }: ListProps): import("react").JSX.Element;
