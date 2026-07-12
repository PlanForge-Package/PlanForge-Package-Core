export type OtpFieldProps = {
    label?: string;
    /** 입력된 숫자 문자열 (최대 length 자리) */
    value: string;
    onChange?: (value: string) => void;
    /** 자릿수 (기본 6) */
    length?: number;
    error?: boolean;
    disabled?: boolean;
    helperText?: string;
    /** 모든 자리 입력 완료 시 호출 */
    onComplete?: (value: string) => void;
};
export declare function OtpField({ label, value, onChange, length, error, disabled, helperText, onComplete, }: OtpFieldProps): import("react").JSX.Element;
