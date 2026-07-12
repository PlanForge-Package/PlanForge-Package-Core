export type SidebarItem = {
    label: string;
    value: string;
    badge?: string;
    disabled?: boolean;
};
export type SidebarSection = {
    title?: string;
    items: SidebarItem[];
};
export type SidebarProps = {
    sections: SidebarSection[];
    value: string;
    onChange?: (value: string) => void;
    width?: number;
};
export declare function Sidebar({ sections, value, onChange, width }: SidebarProps): import("react").JSX.Element;
