export type TreeNode = {
    id: string;
    label: string;
    children?: TreeNode[];
    disabled?: boolean;
};
export type TreeProps = {
    nodes: TreeNode[];
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    defaultExpandedIds?: string[];
};
export declare function Tree({ nodes, selectedId, onSelect, defaultExpandedIds }: TreeProps): import("react").JSX.Element;
