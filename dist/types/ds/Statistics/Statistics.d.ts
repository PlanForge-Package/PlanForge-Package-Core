export type StatItem = {
    label: string;
    value: string;
    /** 증감 % — 양수 success ▲, 음수 error ▼ */
    delta?: number;
    hint?: string;
};
export type StatisticsProps = {
    items: StatItem[];
    columns?: 2 | 3 | 4;
};
export declare function Statistics({ items, columns }: StatisticsProps): import("react").JSX.Element;
