export type TimelineItem = {
    id: string;
    title: string;
    description?: string;
    time?: string;
    status?: 'done' | 'active' | 'pending';
};
export type TimelineProps = {
    items: TimelineItem[];
};
export declare function Timeline({ items }: TimelineProps): import("react").JSX.Element;
