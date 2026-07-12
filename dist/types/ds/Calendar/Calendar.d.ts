export declare function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean;
export declare function formatDateK(d: Date): string;
export type CalendarProps = {
    value?: Date | null;
    onChange?: (d: Date) => void;
    /** 초기 표시 월 */
    month?: Date;
    minDate?: Date;
    maxDate?: Date;
    disabled?: boolean;
};
export declare function Calendar({ value, onChange, month, minDate, maxDate, disabled, }: CalendarProps): import("react").JSX.Element;
