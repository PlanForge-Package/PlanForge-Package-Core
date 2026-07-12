export type KrCertAuthProps = {
    kind: 'joint' | 'finance';
    onComplete?: () => void;
};
export declare function KrCertAuth({ kind, onComplete }: KrCertAuthProps): import("react").JSX.Element;
