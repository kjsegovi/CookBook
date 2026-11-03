import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
export type Commit = (type: string, payload: any) => Promise<boolean>;

export function Action({ children, secondary = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    secondary?: boolean;
}) { return <button className={secondary ? 'button secondary' : 'button'} {...props}>{children}</button>; }
export function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
}) { return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }
export function SectionHead({ title, link, children }: {
    title: string;
    link?: string;
    children?: ReactNode;
}) { return <div className="section-head"><h2>{title}</h2>{link ? <a className="text-link" href={link.startsWith('/') ? '#' + link : link}>View all <ArrowRight size={16}/></a> : children}</div>; }
