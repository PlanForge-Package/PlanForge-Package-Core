export type TabItem = {
    value: string;
    label: string;
    disabled?: boolean;
};
export type TabProps = {
    items: TabItem[];
    value: string;
    onChange?: (value: string) => void;
    variant?: 'segmented' | 'underline';
    size?: 'sm' | 'md';
};
export declare function Tab({ items, value, onChange, variant, size }: TabProps): import("react").JSX.Element;
