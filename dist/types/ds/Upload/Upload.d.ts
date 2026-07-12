import type { ReactNode } from 'react';
export type UploadProps = {
    label?: string;
    files: File[];
    onChange?: (files: File[]) => void;
    accept?: string;
    multiple?: boolean;
    maxFiles?: number;
    disabled?: boolean;
    helperText?: string;
    /** 드롭존 안내 영역 커스텀 */
    children?: ReactNode;
};
/** 바이트 수를 '1.2 MB' 형식 문자열로 변환 */
export declare function formatBytes(n: number): string;
export declare function Upload({ label, files, onChange, accept, multiple, maxFiles, disabled, helperText, children, }: UploadProps): import("react").JSX.Element;
