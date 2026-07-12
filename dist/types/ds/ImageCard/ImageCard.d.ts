export type ImageCardProps = {
    image?: string;
    title: string;
    description?: string;
    ratio?: '4x3' | '16x9';
};
export declare function ImageCard({ image, title, description, ratio, }: ImageCardProps): import("react").JSX.Element;
