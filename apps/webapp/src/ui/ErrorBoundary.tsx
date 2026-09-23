import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Если что-то сломалось при отрисовке – показываем понятный экран вместо белого листа. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ошибка интерфейса', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boot" role="alert">
        <p className="empty__title">Что-то пошло не так</p>
        <p className="text-secondary">Перезапустите приложение. При угрозе жизни звоните 112, при запахе газа – 104.</p>
        <p className="boot__actions">
          <a className="link-btn" href="tel:112">Позвонить 112</a>
          <button type="button" className="link-btn" onClick={() => window.location.reload()}>
            Перезапустить
          </button>
        </p>
      </div>
    );
  }
}
