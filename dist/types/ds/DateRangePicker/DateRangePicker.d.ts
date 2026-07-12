export type DateRangePickerProps = {
    label?: string;
    start: Date | null;
    end: Date | null;
    onChange?: (range: {
        start: Date | null;
        end: Date | null;
    }) => void;
    minDate?: Date;
    maxDate?: Date;
    disabled?: boolean;
    helperText?: string;
};
export declare function DateRangePicker({ label, start, end, onChange, minDate, maxDate, disabled, helperText, }: DateRangePickerProps): import("react").JSX.Element;
