import type { ReactNode } from 'react';
import { ArrowRight , Star } from 'lucide-react';
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
export function Stars({ rating, onRate, size = 18 }: { rating: number; onRate?: (n: number) => void; size?: number }) {
    return <span className="stars" role={onRate ? 'radiogroup' : 'img'} aria-label={`${rating} of 5 stars`}>{[1, 2, 3, 4, 5].map(n => onRate
        ? <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= rating ? 'star on' : 'star'} onClick={() => onRate(rating === n ? 0 : n)}><Star size={size}/></button>
        : <Star key={n} size={size} className={n <= rating ? 'star on' : 'star'}/>)}</span>;
}
