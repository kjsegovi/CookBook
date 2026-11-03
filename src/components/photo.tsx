import { useEffect, useRef, useState } from 'react';
import { Utensils } from 'lucide-react';
import type { Recipe } from '../lib/domain';
import { photoSource } from '../lib/api';
import type { PhotoSource, PhotoVariant } from '../lib/photo-resolver';

export default function Photo({ recipe, className = '', variant = 'thumbnail', priority = false }: {
    recipe: Pick<Recipe, 'image' | 'title'>; className?: string; variant?: PhotoVariant; priority?: boolean;
}) {
    const container = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(priority), [failed, setFailed] = useState(false), [source, setSource] = useState<PhotoSource>();
    useEffect(() => {
        if (priority || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' });
        if (container.current) observer.observe(container.current);
        return () => observer.disconnect();
    }, [priority]);
    useEffect(() => {
        setFailed(false); setSource(undefined);
        if (!visible || !recipe.image) return;
        let active = true;
        photoSource(recipe.image, variant).then(next => { if (active) setSource(next); }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [recipe.image, variant, visible]);
    return <div ref={container} className={'recipe-photo ' + className}>{source?.url && !failed ?
        <img src={source.url} alt={recipe.title} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" referrerPolicy="no-referrer" onError={() => {
            if (source.fallback && source.fallback !== source.url) setSource({ url: source.fallback }); else setFailed(true);
        }} /> : <div className="photo-placeholder"><Utensils aria-hidden="true" /><span>{recipe.image && !failed ? 'Loading photo…' : 'No photo yet'}</span></div>}</div>;
}
