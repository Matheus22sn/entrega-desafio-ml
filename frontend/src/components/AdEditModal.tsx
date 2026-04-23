import type { FormEvent } from 'react';
import type { Ad, EditAdFormState } from '../types';

type AdEditModalProps = {
  ad: Ad | null;
  open: boolean;
  form: EditAdFormState;
  isSubmitting: boolean;
  onClose: () => void;
  onFieldChange: (field: keyof EditAdFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AdEditModal({
  ad,
  open,
  form,
  isSubmitting,
  onClose,
  onFieldChange,
  onSubmit,
}: AdEditModalProps) {
  if (!open || !ad) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-ad-title">
        <header className="modal-card__header">
          <div>
            <span className="section-tag">Edicao rapida</span>
            <h2 id="edit-ad-title">Atualizar anuncio {ad.ml_id}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Fechar
          </button>
        </header>

        <form className="modal-form" onSubmit={onSubmit}>
          <div className="modal-form__grid">
            <label className="field field--full">
              <span>Titulo</span>
              <input
                value={form.title}
                onChange={(event) => onFieldChange('title', event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Preco</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={(event) => onFieldChange('price', event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Estoque</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.available_quantity}
                onChange={(event) => onFieldChange('available_quantity', event.target.value)}
                required
              />
            </label>
          </div>

          <footer className="modal-card__footer">
            <p className="modal-card__hint">
              Esta acao atualiza o item no Mercado Livre, reaplica o snapshot local e bloqueia salvamento se a versao local mudou no meio da edicao.
            </p>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default AdEditModal;
