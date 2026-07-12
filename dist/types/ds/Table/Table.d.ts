import type { ReactNode } from 'react';
export type TableColumn<T> = {
    key: string;
    header: string;
    width?: number | string;
    align?: 'left' | 'center' | 'right';
    sortable?: boolean;
    render?: (row: T) => ReactNode;
};
export type TableProps<T> = {
    columns: TableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    striped?: boolean;
    bordered?: boolean;
    compact?: boolean;
    emptyText?: string;
    onRowClick?: (row: T) => void;
};
export declare function Table<T>({ columns, rows, rowKey, striped, bordered, compact, emptyText, onRowClick, }: TableProps<T>): import("react").JSX.Element;
