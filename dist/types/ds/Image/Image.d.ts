export type ImageProps = {
    src?: string;
    alt?: string;
    ratio?: '1x1' | '4x3' | '16x9';
    rounded?: boolean;
};
export declare function Image({ src, alt, ratio, rounded }: ImageProps): import("react").JSX.Element;
