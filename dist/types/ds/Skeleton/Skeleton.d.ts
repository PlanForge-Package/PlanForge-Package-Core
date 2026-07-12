export type SkeletonProps = {
    variant?: 'text' | 'block' | 'circle';
    width?: string | number;
    height?: string | number;
    lines?: number;
};
export declare function Skeleton({ variant, width, height, lines, }: SkeletonProps): import("react").JSX.Element;
