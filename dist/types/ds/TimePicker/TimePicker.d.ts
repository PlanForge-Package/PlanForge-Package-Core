export type TimePickerProps = {
    label?: string;
    /** 'HH:MM' 24시간제, 미선택은 '' */
    value: string;
    onChange?: (v: string) => void;
    minuteStep?: 5 | 10 | 15 | 30;
    disabled?: boolean;
    helperText?: string;
};
export declare function TimePicker({ label, value, onChange, minuteStep, disabled, helperText, }: TimePickerProps): import("react").JSX.Element;
