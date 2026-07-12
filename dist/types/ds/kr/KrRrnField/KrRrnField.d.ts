export type KrRrnFieldProps = {
    label?: string;
    /** 원본 숫자만 보관 (최대 13자리) — 표시용 마스킹은 내부에서 처리한다 */
    value: string;
    onChange?: (value: string) => void;
    /** 외국인등록번호 모드 — 레이블·문구만 변경, 형식은 동일 */
    foreigner?: boolean;
    /** 블러 또는 13자리 완성 시 정상·에러 상태 자동 표시 */
    validate?: boolean;
    placeholder?: string;
    disabled?: boolean;
};
export declare function KrRrnField({ label, value, onChange, foreigner, validate, placeholder, disabled, }: KrRrnFieldProps): import("react").JSX.Element;
