export type SliderProps = {
    label?: string;
    value: number;
    onChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    showValue?: boolean;
    disabled?: boolean;
};
export declare function Slider({ label, value, onChange, min, max, step, unit, showValue, disabled, }: SliderProps): import("react").JSX.Element;
