import './brand.css';
export type SocialLoginButtonProps = {
    provider: 'kakao' | 'google' | 'facebook' | 'naver' | 'apple' | 'microsoft' | 'x';
    size: 'md' | 'lg';
    label?: string;
    showLogo?: boolean;
    onClick?: () => void;
};
export declare function SocialLoginButton({ provider, size, label, showLogo, onClick, }: SocialLoginButtonProps): import("react").JSX.Element;
