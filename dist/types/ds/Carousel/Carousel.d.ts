import { type ReactNode } from 'react';
export type CarouselProps = {
    slides: ReactNode[];
    /** 컨트롤드로 쓸 때만 전달 */
    index?: number;
    onIndexChange?: (i: number) => void;
    showDots?: boolean;
    showArrows?: boolean;
    loop?: boolean;
    aspectRatio?: string;
};
export declare function Carousel({ slides, index, onIndexChange, showDots, showArrows, loop, aspectRatio, }: CarouselProps): import("react").JSX.Element;
