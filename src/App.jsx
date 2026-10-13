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
            <h1>Something went wrong loading your dashboard.</h1>
            <p style={{ color: '#a6a5ba' }}>Refresh the page and try again. If this continues, share this message with support: {this.state.error.message}</p>
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