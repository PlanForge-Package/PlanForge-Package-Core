export type KrCardFormValues = {
    cardNo: string;
    expiry: string;
    cvc: string;
    owner: string;
    cashReceipt: boolean;
    cashReceiptType: 'phone' | 'biz';
};
export type KrCardFormProps = {
    onSubmit?: (values: KrCardFormValues) => void;
    disabled?: boolean;
};
export declare function KrCardForm({ onSubmit, disabled }: KrCardFormProps): import("react").JSX.Element;
