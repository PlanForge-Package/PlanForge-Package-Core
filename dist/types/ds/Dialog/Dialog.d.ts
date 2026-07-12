export type DialogProps = {
    open: boolean;
    variant: 'alert' | 'confirm' | 'prompt';
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: (value?: string) => void;
    onCancel?: () => void;
    /** true면 확인 버튼을 error 색상으로 */
    danger?: boolean;
    /** prompt 입력창 플레이스홀더 */
    placeholder?: string;
    /** 문서/데모용 인라인 렌더 — fixed 오버레이 없이 정적 배치 */
    inline?: boolean;
};
export declare function Dialog({ open, variant, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, danger, placeholder, inline, }: DialogProps): import("react").JSX.Element;
