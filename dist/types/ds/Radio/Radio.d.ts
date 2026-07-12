export type RadioOption = {
    value: string;
    label: string;
    disabled?: boolean;
};
export type RadioProps = {
    options: RadioOption[];
    value: string;
    onChange?: (value: string) => void;
    name: string;
    direction?: 'row' | 'column';
};
export declare function Radio({ options, value, onChange, name, direction }: RadioProps): import("react").JSX.Element;
