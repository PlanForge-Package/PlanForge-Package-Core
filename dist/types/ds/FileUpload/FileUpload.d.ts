export type FileUploadProps = {
    label?: string;
    files: File[];
    onChange?: (files: File[]) => void;
    accept?: string;
    multiple?: boolean;
    maxFiles?: number;
    disabled?: boolean;
    helperText?: string;
};
export declare function FileUpload({ label, files, onChange, accept, multiple, maxFiles, disabled, helperText, }: FileUploadProps): import("react").JSX.Element;
