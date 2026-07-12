export type FormProps = {
    title?: string;
    submitLabel?: string;
    onSubmit?: () => void;
};
export declare function Form({ title, submitLabel, onSubmit }: FormProps): import("react").JSX.Element;
