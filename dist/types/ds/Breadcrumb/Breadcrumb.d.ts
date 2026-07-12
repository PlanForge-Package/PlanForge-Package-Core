export type BreadcrumbItem = {
    label: string;
    href?: string;
};
export type BreadcrumbProps = {
    items: BreadcrumbItem[];
    separator?: string;
    /** 초과 시 가운데 '…' 축약 — 첫 항목 + … + 마지막 2개 */
    maxItems?: number;
};
export declare function Breadcrumb({ items, separator, maxItems }: BreadcrumbProps): import("react").JSX.Element;
