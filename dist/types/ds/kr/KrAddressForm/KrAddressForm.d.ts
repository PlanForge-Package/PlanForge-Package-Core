export declare const KR_ADDRESS_REQUESTS: readonly ["문 앞에 놓아주세요", "경비실에 맡겨주세요", "배송 전 연락주세요", "직접 입력"];
export type KrAddressFormValue = {
    postcode: string;
    road: string;
    jibun: string;
    detail: string;
    /** 배송 요청사항 ('' = 미선택) */
    request: string;
    /** '직접 입력' 선택 시 내용 */
    requestNote: string;
};
export declare const EMPTY_KR_ADDRESS: KrAddressFormValue;
export type KrAddressFormProps = {
    value: KrAddressFormValue;
    onChange: (value: KrAddressFormValue) => void;
    /** 배송 요청사항 select 노출 */
    withRequest?: boolean;
    /** 상세주소 필수 미입력 에러 */
    detailError?: boolean;
    disabled?: boolean;
};
export declare function KrAddressForm({ value, onChange, withRequest, detailError, disabled, }: KrAddressFormProps): import("react").JSX.Element;
