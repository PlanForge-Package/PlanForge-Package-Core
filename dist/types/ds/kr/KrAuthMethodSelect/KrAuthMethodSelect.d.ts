import './brand.css';
export type AuthMethodId = 'pass' | 'kakao' | 'naver' | 'joint' | 'finance';
export type AuthMethod = {
    id: string;
    label: string;
    description: string;
};
export declare const AUTH_METHODS: AuthMethod[];
export type KrAuthMethodSelectProps = {
    value: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    methods?: AuthMethod[];
};
export declare function KrAuthMethodSelect({ value, onChange, disabled, methods, }: KrAuthMethodSelectProps): import("react").JSX.Element;
