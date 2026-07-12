export type ImageUploadProps = {
    label?: string;
    files: File[];
    onChange?: (files: File[]) => void;
    maxFiles?: number;
    disabled?: boolean;
    helperText?: string;
};
export declare function ImageUpload({ label, files, onChange, maxFiles, disabled, helperText, }: ImageUploadProps): import("react").JSX.Element;
