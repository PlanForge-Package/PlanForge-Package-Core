export type BadgeProps = {
    variant: 'primary' | 'secondary' | 'error' | 'success' | 'warning';
    appearance?: 'solid' | 'soft' | 'outline';
    label: string;
    size: 'sm' | 'md';
};
export declare function Badge({ variant, appearance, label, size }: BadgeProps): import("react").JSX.Element;
