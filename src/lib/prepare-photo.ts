export function fittedDimensions(width: number, height: number, maximum: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('This photo could not be read.');
    const scale = Math.min(1, maximum / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function preparePhoto(file: File): Promise<FormData | File> {
    if (file.size > 30000000) throw new Error('Choose a photo under 30 MB.');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
    if (typeof createImageBitmap !== 'function') {
        if (file.size > 5242880) throw new Error('Choose a photo under 5 MB in this browser.');
        return file;
    }
    const image = await createImageBitmap(file);
    try {
        const render = async (maximum: number, quality: number) => {
            const dimensions = fittedDimensions(image.width, image.height, maximum);
            const canvas = document.createElement('canvas');
            canvas.width = dimensions.width; canvas.height = dimensions.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Your photo could not be prepared.');
            context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
            const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Your photo could not be prepared.')), 'image/webp', quality));
            if (blob.type !== 'image/webp') throw new Error('WebP encoding is unavailable.');
            return blob;
        };
        const [photo, thumbnail] = await Promise.all([render(1600, 0.84), render(480, 0.76)]);
        const form = new FormData(); form.set('photo', photo, 'recipe.webp'); form.set('thumbnail', thumbnail, 'recipe.thumb.webp');
        return form;
    } catch (error) {
        // Older browsers can still upload a normal-size original. Its cards use
        // the existing full-photo fallback until a thumbnail is available.
        if (file.size <= 5242880) return file;
        throw new Error('Your browser could not prepare this photo. Try a smaller image.', { cause: error });
    } finally { image.close(); }
}
