import { type KeyboardEvent, type ReactNode } from 'react';
export type InputBaseProps = {
    label?: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    type?: 'text' | 'password' | 'email' | 'search' | 'tel';
    inputMode?: 'text' | 'numeric' | 'tel' | 'email' | 'decimal' | 'search';
    error?: boolean;
    success?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    helperText?: string;
    maxLength?: number;
    showCounter?: boolean;
    /** 인풋 좌/우 액세서리 — 아이콘, 토글 버튼, 스텝퍼 등 */
    leading?: ReactNode;
    trailing?: ReactNode;
    onBlur?: () => void;
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
};
export declare function InputBase({ label, value, onChange, placeholder, type, inputMode, error, success, disabled, readOnly, required, helperText, maxLength, showCounter, leading, trailing, onBlur, onKeyDown, }: InputBaseProps): import("react").JSX.Element;
export declare const inputStyles: CSSModuleClasses;
