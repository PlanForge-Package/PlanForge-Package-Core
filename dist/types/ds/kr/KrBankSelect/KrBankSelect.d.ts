export declare const KR_BANKS: readonly ["KB국민", "신한", "우리", "하나", "NH농협", "IBK기업", "SC제일", "씨티", "카카오뱅크", "케이뱅크", "토스뱅크", "새마을금고", "신협", "우체국", "수협", "대구", "부산", "광주", "전북", "경남", "제주"];
export type KrBankSelectProps = {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    label?: string;
};
export declare function KrBankSelect({ value, onChange, disabled, label }: KrBankSelectProps): import("react").JSX.Element;
