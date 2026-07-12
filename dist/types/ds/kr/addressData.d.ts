export type KrAddress = {
    /** 우편번호 5자리 */
    postcode: string;
    /** 도로명 주소 */
    road: string;
    /** 지번 주소 */
    jibun: string;
    /** 건물명 (선택) */
    building?: string;
};
export declare const SAMPLE_ADDRESSES: KrAddress[];
/** 공백 단위 토큰이 모두 포함되는 주소를 반환한다. 빈 질의는 전체 목록. */
export declare function searchAddresses(query: string): KrAddress[];
