export type ToastProps = {
    tone: 'success' | 'info' | 'warning' | 'error';
    message: string;
    onClose?: () => void;
    showIcon?: boolean;
};
export declare function Toast({ tone, message, onClose, showIcon }: ToastProps): import("react").JSX.Element;
