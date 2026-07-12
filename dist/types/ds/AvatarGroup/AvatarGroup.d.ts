export type AvatarGroupProps = {
    /** 표시할 이름들. 이니셜은 각 이름의 첫 글자를 사용한다. */
    names?: string[];
    /** 노출할 최대 아바타 수. 초과분은 '+N' 원으로 묶는다. */
    max?: number;
    /** 아바타 크기. */
    size?: 'sm' | 'md';
};
export declare function AvatarGroup({ names, max, size }: AvatarGroupProps): import("react").JSX.Element;
