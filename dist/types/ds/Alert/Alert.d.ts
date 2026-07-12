export type AlertProps = {
    variant: 'info' | 'success' | 'warning' | 'error';
    label: string;
    showIcon?: boolean;
};
export declare function Alert({ variant, label, showIcon }: AlertProps): import("react").JSX.Element;
