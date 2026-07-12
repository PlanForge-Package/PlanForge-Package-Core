export type KrVehicleNoFieldProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    /** 블러 또는 자릿수 완성 시 정상·에러 상태 자동 표시 */
    validate?: boolean;
    placeholder?: string;
    disabled?: boolean;
};
export declare function KrVehicleNoField({ label, value, onChange, validate, placeholder, disabled, }: KrVehicleNoFieldProps): import("react").JSX.Element;
