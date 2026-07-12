export declare const digitsOnly: (v: string) => string;
/** 휴대폰: 01X-XXXX-XXXX (10자리는 01X-XXX-XXXX) */
export declare function formatPhone(v: string): string;
export declare function validatePhone(v: string): boolean;
/** 주민등록번호: XXXXXX-XXXXXXX */
export declare function formatRrn(v: string): string;
/**
 * 주민등록번호 검증.
 * - 기본: 형식(13자리) + 생년월일 유효성 + 성별코드(1~8)
 * - checksum 옵션: 가중치 2~5 검증식. 2020-10 이후 신규 발급분에는 검증식이
 *   적용되지 않으므로 기본 false를 권장한다.
 */
export declare function validateRrn(v: string, opts?: {
    checksum?: boolean;
}): boolean;
/** 사업자등록번호: XXX-XX-XXXXX */
export declare function formatBizNo(v: string): string;
/** 사업자등록번호 검증식 (국세청 공식 가중치) */
export declare function validateBizNo(v: string): boolean;
/** 카드번호: XXXX-XXXX-XXXX-XXXX */
export declare function formatCardNo(v: string): string;
/** Luhn 체크 (카드번호) */
export declare function luhnCheck(v: string): boolean;
/** 카드 유효기간: MM/YY */
export declare function formatExpiry(v: string): string;
export declare function validateExpiry(v: string): boolean;
/** 차량번호: 12가3456 / 123가4567 (형식 검증만) */
export declare function validateVehicleNo(v: string): boolean;
/** 우편번호: 5자리 */
export declare function formatPostcode(v: string): string;
