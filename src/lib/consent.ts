export function consentRequest(pathname: string, _base: string): { isConsent: boolean; authorizationId: string | null } {
    const [path, query = ''] = pathname.split('#')[0].split('?');
    const isConsent = /\/oauth\/consent\/?$/.test(path);
    return { isConsent, authorizationId: isConsent ? new URLSearchParams(query).get('authorization_id') || null : null };
}
