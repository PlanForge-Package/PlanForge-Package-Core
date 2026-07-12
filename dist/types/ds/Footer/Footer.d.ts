export type FooterLink = {
    label: string;
    href?: string;
};
export type FooterProps = {
    copyright: string;
    links?: FooterLink[];
    description?: string;
};
export declare function Footer({ copyright, links, description }: FooterProps): import("react").JSX.Element;
