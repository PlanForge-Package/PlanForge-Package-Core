export type KbdProps = {
    keys: string[];
    /** 키 사이에 '+' 구분자를 표시할지 여부 */
    withSeparator?: boolean;
};
export declare function Kbd({ keys, withSeparator }: KbdProps): import("react").JSX.Element;
