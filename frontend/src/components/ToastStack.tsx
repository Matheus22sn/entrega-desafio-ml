import type { ToastMessage } from '../types';

type ToastStackProps = {
  items: ToastMessage[];
  onDismiss: (id: number) => void;
};

function ToastStack({ items, onDismiss }: ToastStackProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite" aria-label="Notifications">
      {items.map((item) => (
        <section key={item.id} className={`toast toast--${item.tone}`}>
          <div>
            <strong className="toast__title">{item.title}</strong>
            {item.description ? <p className="toast__description">{item.description}</p> : null}
          </div>
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss notification"
          >
            x
          </button>
        </section>
      ))}
    </div>
  );
}

export default ToastStack;
