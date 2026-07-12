export type KrPhoneFieldProps = {
    label?: string;
    /** 하이픈 포함 표시값 — formatPhone 결과를 그대로 보관한다 */
    value: string;
    onChange?: (value: string) => void;
    /** 블러 또는 자릿수 완성 시 정상·에러 상태 자동 표시 */
    validate?: boolean;
    onValidChange?: (valid: boolean) => void;
    placeholder?: string;
    disabled?: boolean;
};
export declare function KrPhoneField({ label, value, onChange, validate, onValidChange, placeholder, disabled, }: KrPhoneFieldProps): import("react").JSX.Element;
