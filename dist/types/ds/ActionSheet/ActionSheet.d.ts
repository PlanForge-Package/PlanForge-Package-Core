export type ActionSheetAction = {
    label: string;
    onSelect?: () => void;
    danger?: boolean;
    disabled?: boolean;
};
export type ActionSheetProps = {
    open: boolean;
    onClose?: () => void;
    title?: string;
    actions: ActionSheetAction[];
    cancelLabel?: string;
    /** 문서/데모용 인라인 렌더 — fixed 오버레이 없이 정적 배치 */
    inline?: boolean;
};
export declare function ActionSheet({ open, onClose, title, actions, cancelLabel, inline, }: ActionSheetProps): import("react").JSX.Element;
