export declare const CARRIERS: readonly ["SKT", "KT", "LG U+", "SKT 알뜰폰", "KT 알뜰폰", "LG U+ 알뜰폰"];
export type Carrier = (typeof CARRIERS)[number];
export type KrCarrierSelectProps = {
    value: string;
    onChange?: (value: Carrier) => void;
    disabled?: boolean;
};
export declare function KrCarrierSelect({ value, onChange, disabled }: KrCarrierSelectProps): import("react").JSX.Element;
