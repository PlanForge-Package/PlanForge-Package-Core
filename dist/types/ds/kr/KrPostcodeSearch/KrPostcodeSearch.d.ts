import { type KrAddress } from '../addressData';
export type KrPostcodeSearchProps = {
    label?: string;
    /** 우편번호 5자리 — 조회 결과로만 채워진다(직접 입력 불가) */
    postcode: string;
    onSelect: (address: KrAddress) => void;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
};
export declare function KrPostcodeSearch({ label, postcode, onSelect, disabled, error, helperText, }: KrPostcodeSearchProps): import("react").JSX.Element;
