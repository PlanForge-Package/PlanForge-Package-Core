export type AvatarProps = {
    name: string;
    src?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    shape?: 'circle' | 'rounded';
    status?: 'online' | 'offline' | 'busy';
};
export declare function Avatar({ name, src, size, shape, status }: AvatarProps): import("react").JSX.Element;
