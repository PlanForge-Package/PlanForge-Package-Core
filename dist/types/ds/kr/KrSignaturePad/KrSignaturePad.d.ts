export type KrSignaturePadProps = {
    width?: number;
    height?: number;
    disabled?: boolean;
    onChange?: (dataUrl: string | null) => void;
};
export declare function KrSignaturePad({ width, height, disabled, onChange, }: KrSignaturePadProps): import("react").JSX.Element;
