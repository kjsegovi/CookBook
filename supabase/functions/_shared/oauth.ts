export function protectedResource(request: Request) {
    const publicUrl = typeof Deno !== 'undefined' ? Deno.env.get('COOKBOOK_PUBLIC_URL') : undefined;
    const url = new URL(publicUrl || request.url);
    // The gateway terminates TLS before forwarding requests to the edge function.
    if (!publicUrl && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.protocol = 'https:';
    const origin = url.origin;
    return {
        resource: origin + '/functions/v1/cookbook',
        authorization_servers: [origin + '/auth/v1'],
        scopes_supported: [],
        bearer_methods_supported: ['header'],
        resource_name: 'CookBook kitchen',
        resource_documentation: origin + '/functions/v1/cookbook',
    };
}
export function challenge(request: Request, scope = 'cookbook') {
    return `Bearer resource_metadata="${protectedResource(request).resource}/.well-known/oauth-protected-resource"`;
}
