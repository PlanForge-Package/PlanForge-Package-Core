export type PaginationProps = {
    page: number;
    totalPages: number;
    onChange?: (page: number) => void;
    siblingCount?: number;
};
export declare function Pagination({ page, totalPages, onChange, siblingCount }: PaginationProps): import("react").JSX.Element;
