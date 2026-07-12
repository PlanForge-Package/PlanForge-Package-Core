import { type KrAddress } from '../addressData';
export type KrAddressAutocompleteProps = {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    /** 항목 선택 시 전체 주소(우편번호/도로명/지번) 전달 */
    onSelect?: (address: KrAddress) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
};
export declare function KrAddressAutocomplete({ label, value, onChange, onSelect, placeholder, disabled, error, helperText, }: KrAddressAutocompleteProps): import("react").JSX.Element;
