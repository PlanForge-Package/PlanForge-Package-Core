export type DatePickerProps = {
    label?: string;
    value: Date | null;
    onChange?: (d: Date | null) => void;
    placeholder?: string;
    minDate?: Date;
    maxDate?: Date;
    disabled?: boolean;
    error?: boolean;
    helperText?: string;
};
export declare function DatePicker({ label, value, onChange, placeholder, minDate, maxDate, disabled, error, helperText, }: DatePickerProps): import("react").JSX.Element;
