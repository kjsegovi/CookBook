import { Component, type ReactNode } from 'react';

export class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        if (this.state.failed) return <div className="alert error" role="alert"><span>This part of your cookbook couldn’t load. Check your connection and reload when you’re ready.</span><button type="button" className="text-link" onClick={() => window.location.reload()}>Reload</button></div>;
        return this.props.children;
    }
}
