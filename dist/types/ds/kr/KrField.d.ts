import { type ReactNode } from 'react';
export type KrFieldProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    error?: boolean;
    success?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    helperText?: string;
    inputMode?: 'numeric' | 'tel' | 'text';
    maxLength?: number;
    /** 인풋 우측 액세서리 — 마스킹 토글, 우편번호 조회 버튼 등 */
    trailing?: ReactNode;
};
export declare function KrField({ label, value, onChange, placeholder, error, success, disabled, readOnly, helperText, inputMode, maxLength, trailing, }: KrFieldProps): import("react").JSX.Element;
