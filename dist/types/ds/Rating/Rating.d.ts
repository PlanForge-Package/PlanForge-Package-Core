export type RatingProps = {
    value?: number;
    max?: number;
    size?: 'sm' | 'md';
    readOnly?: boolean;
    onChange?: (value: number) => void;
};
export declare function Rating({ value, max, size, readOnly, onChange, }: RatingProps): import("react").JSX.Element;
