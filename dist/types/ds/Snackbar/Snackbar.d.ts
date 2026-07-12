export type SnackbarProps = {
    open: boolean;
    message: string;
    variant?: 'default' | 'success' | 'error';
    actionLabel?: string;
    onAction?: () => void;
    onClose?: () => void;
    /** 자동 닫힘까지의 시간(ms). open이 true가 되면 타이머 종료 후 onClose가 호출된다. */
    duration?: number;
    showClose?: boolean;
    /** 문서/데모용 인라인 렌더 — fixed 대신 정적 배치 */
    inline?: boolean;
};
export declare function Snackbar({ open, message, variant, actionLabel, onAction, onClose, duration, showClose, inline, }: SnackbarProps): import("react").JSX.Element;
