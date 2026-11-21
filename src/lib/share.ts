// Links shared to CookBook (share sheet, share target, bookmarklet) arrive as
// ?share-url=, or ?url= / ?text= from the web share target.
export function sharedLink(search: string) {
    const params = new URLSearchParams(search);
    for (const value of [params.get('share-url'), params.get('url'), params.get('text'), params.get('title')]) {
        const match = value?.match(/https?:\/\/[^\s<>"]+/)?.[0];
        if (match) return match.replace(/[),.!]+$/, '');
    }
    return '';
}
