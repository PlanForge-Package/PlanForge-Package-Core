export type LoadingProps = {
    variant?: 'spinner' | 'dots';
    size?: 'sm' | 'md' | 'lg';
    /** 인디케이터 아래에 표시할 텍스트 */
    label?: string;
    /** true면 부모를 덮는 반투명 오버레이로 중앙 배치 — 부모에 position: relative가 필요하다 */
    overlay?: boolean;
};
export declare function Loading({ variant, size, label, overlay }: LoadingProps): import("react").JSX.Element;
