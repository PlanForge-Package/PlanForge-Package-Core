export type KrPhoneAuthProps = {
    onComplete?: (result: {
        name: string;
        phone: string;
    }) => void;
};
export declare function KrPhoneAuth({ onComplete }: KrPhoneAuthProps): import("react").JSX.Element;
