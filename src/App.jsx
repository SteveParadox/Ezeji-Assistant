import React from 'react';
import NightlineApp from './NightlineApp';
import { ConfirmationProvider } from './ui';

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#12131f', color: '#f5f4f8', fontFamily: 'Inter, sans-serif' }}>
          <section style={{ maxWidth: 520 }}>
            <h1>We couldn't load this page.</h1>
            <p style={{ color: '#a6a5ba' }} role="alert">Your changes may not have been saved. Reload to retry, or return to the homepage.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
              <button type="button" onClick={() => window.location.reload()}
                style={{ border: 0, borderRadius: 8, padding: '12px 18px', background: '#FFA53C', color: '#12131F', fontWeight: 600, cursor: 'pointer' }}>Reload page</button>
              <a href="/" style={{ border: '1px solid #2B2D40', borderRadius: 8, padding: '12px 18px', color: '#F5F4F8', textDecoration: 'none' }}>Return to homepage</a>
            </div>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function App() {
  return <AppErrorBoundary><ConfirmationProvider><NightlineApp /></ConfirmationProvider></AppErrorBoundary>;
}
export default App;