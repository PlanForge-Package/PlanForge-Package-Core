export type KrStepIndicatorProps = {
    steps: string[];
    /** 0-based 현재 단계 인덱스 */
    current: number;
};
export declare function KrStepIndicator({ steps, current }: KrStepIndicatorProps): import("react").JSX.Element;
